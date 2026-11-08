import * as pulumi from "@pulumi/pulumi";
import * as proxmoxve from "@muhlba91/pulumi-proxmoxve";
import * as talos from "@pulumiverse/talos";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface TalosClusterArgs {
  provider: proxmoxve.Provider;
  nodeName: string;
  datastore: string;
  bridge: string;
  imageStorage: string;
  clusterName: string;
  talosVersion: string;
  gateway: string;
  cidrPrefix: number;
  dnsServer: string;
  cpIp: string;
  workerIp: string;
}

// ---------------------------------------------------------------------------
// Cluster deployment
// ---------------------------------------------------------------------------
export function deployTalosCluster(args: TalosClusterArgs) {
  const {
    provider,
    nodeName,
    datastore,
    bridge,
    imageStorage,
    clusterName,
    talosVersion,
    gateway,
    cidrPrefix,
    dnsServer,
    cpIp,
    workerIp,
  } = args;

  // -----------------------------------------------------------------------
  // 1. Image Factory — build a schematic with the QEMU guest agent extension
  //    and resolve the nocloud disk image URL for the requested Talos version.
  // -----------------------------------------------------------------------
  const schematic = new talos.imagefactory.Schematic("talos-schematic", {
    schematic: `customization:
  systemExtensions:
    officialExtensions:
      - siderolabs/qemu-guest-agent`,
  });

  const imageUrls = talos.imagefactory.getUrlsOutput({
    talosVersion,
    schematicId: schematic.id,
    platform: "nocloud",
    architecture: "amd64",
  });

  // -----------------------------------------------------------------------
  // 2. Download the Talos nocloud ISO to Proxmox storage.
  //    The ISO is uncompressed — no decompressionAlgorithm needed.
  //    (The raw disk image alternative is .xz compressed, which Proxmox's
  //    download API does not support.)
  // -----------------------------------------------------------------------
  const talosImage = new proxmoxve.download.FileLegacy(
    "talos-nocloud-image",
    {
      contentType: "iso",
      datastoreId: imageStorage,
      nodeName: nodeName,
      fileName: pulumi.interpolate`talos-${talosVersion}-nocloud-amd64.iso`,
      url: imageUrls.urls.iso,
      overwriteUnmanaged: true,
    },
    { provider },
  );

  // Proxmox file ID format: "<storage>:<contentType>/<fileName>"
  const imageFileId = pulumi.interpolate`${talosImage.datastoreId}:iso/${talosImage.fileName}`;

  // -----------------------------------------------------------------------
  // 3. Create nodes.
  //    Each VM has a blank SCSI disk (Talos installs here on first config
  //    apply) and the nocloud ISO as a CD-ROM.
  //    Boot order: try disk first — blank on first boot so falls back to
  //    ISO; after Talos installs and reboots it boots from disk directly.
  //    Static IPs are injected via Proxmox cloud-init (nocloud datasource).
  // -----------------------------------------------------------------------
  function makeNode(
    name: string,
    vmId: number,
    ip: string,
    cores: number,
    memoryMb: number,
    diskGb: number,
  ): proxmoxve.VmLegacy {
    return new proxmoxve.VmLegacy(
      name,
      {
        nodeName: nodeName,
        name: name,
        vmId: vmId,

        cpu: { cores, type: "host" },
        memory: { dedicated: memoryMb },

        // Blank disk — Talos installs here when the machine config is applied.
        disks: [
          {
            datastoreId: datastore,
            interface: "scsi0",
            size: diskGb,
          },
        ],

        // Nocloud ISO — boots Talos into maintenance mode and reads
        // cloud-init for the static IP before config apply.
        cdrom: {
          fileId: imageFileId,
          interface: "ide3",
        },

        // Static IP via Proxmox cloud-init. Talos's nocloud datasource
        // reads this at first boot to configure the network interface.
        initialization: {
          datastoreId: datastore,
          dns: { servers: [dnsServer] },
          ipConfigs: [
            {
              ipv4: {
                address: `${ip}/${cidrPrefix}`,
                gateway: gateway,
              },
            },
          ],
        },

        networkDevices: [{ bridge, model: "virtio" }],
        operatingSystem: { type: "l26" },
        // QEMU guest agent is baked into the schematic; enable it so
        // Proxmox can cleanly shut down the VM.
        agent: { enabled: true },
        started: true,
        // Disk-first: blank on first boot → falls back to ISO (maintenance
        // mode + config apply + install). After install, boots from disk.
        bootOrders: ["scsi0", "ide3"],
      },
      { provider },
    );
  }

  const cpVm = makeNode("moxy-cp-1", 9101, cpIp, 2, 4096, 20);
  const workerVm = makeNode("moxy-worker-1", 9102, workerIp, 2, 4096, 20);

  // -----------------------------------------------------------------------
  // 4. Talos machine secrets — cluster PKI, bootstrap tokens, etc.
  //    These are generated once and stored in Pulumi state; never regenerated
  //    unless the resource is explicitly deleted.
  // -----------------------------------------------------------------------
  const secrets = new talos.machine.Secrets("talos-secrets", { talosVersion });

  const clusterEndpoint = `https://${cpIp}:6443`;

  // -----------------------------------------------------------------------
  // 5. Machine configurations (control-plane + worker).
  //    configPatches are strategic merge patches applied on top of the
  //    generated config: hostname, DNS, install disk, and cert SANs.
  // -----------------------------------------------------------------------
  function machineConfig(type: "controlplane" | "worker", ip: string) {
    const cpSanPatch =
      type === "controlplane"
        ? `\ncluster:\n  apiServer:\n    certSANs:\n      - ${cpIp}`
        : "";

    return talos.machine.getConfigurationOutput({
      clusterName,
      clusterEndpoint,
      machineType: type,
      talosVersion,
      machineSecrets: secrets.machineSecrets,
      configPatches: [
        `machine:
  network:
    nameservers:
      - ${dnsServer}
    interfaces:
      - deviceSelector:
          physical: true
        addresses:
          - ${ip}/${cidrPrefix}
        routes:
          - network: 0.0.0.0/0
            gateway: ${gateway}
  install:
    disk: /dev/sda${cpSanPatch}`,
      ],
    });
  }

  const cpConfig = machineConfig("controlplane", cpIp);
  const workerConfig = machineConfig("worker", workerIp);

  // -----------------------------------------------------------------------
  // 6. Apply machine configurations to each node.
  //    Runs after the VMs are up and reachable on the Talos API port (50000).
  // -----------------------------------------------------------------------
  const applyCp = new talos.machine.ConfigurationApply(
    "apply-cp",
    {
      clientConfiguration: secrets.clientConfiguration,
      machineConfigurationInput: cpConfig.machineConfiguration,
      node: cpIp,
      endpoint: cpIp,
    },
    { dependsOn: [cpVm] },
  );

  const applyWorker = new talos.machine.ConfigurationApply(
    "apply-worker",
    {
      clientConfiguration: secrets.clientConfiguration,
      machineConfigurationInput: workerConfig.machineConfiguration,
      node: workerIp,
      endpoint: workerIp,
    },
    { dependsOn: [workerVm] },
  );

  // -----------------------------------------------------------------------
  // 7. Bootstrap — initialises etcd on the control-plane node.
  //    Must run after the control-plane config is applied and the node
  //    has rebooted into the new config.
  // -----------------------------------------------------------------------
  const bootstrap = new talos.machine.Bootstrap(
    "bootstrap",
    {
      clientConfiguration: secrets.clientConfiguration,
      node: cpIp,
      endpoint: cpIp,
    },
    { dependsOn: [applyCp] },
  );

  // -----------------------------------------------------------------------
  // 8. Outputs — kubeconfig and talosconfig.
  //    Both are marked as secrets so they are never shown in plain text.
  // -----------------------------------------------------------------------
  const kubeconfig = new talos.cluster.Kubeconfig(
    "kubeconfig",
    {
      clientConfiguration: secrets.clientConfiguration,
      node: cpIp,
      endpoint: cpIp,
    },
    { dependsOn: [bootstrap, applyWorker] },
  );

  const talosconfig = talos.client.getConfigurationOutput({
    clusterName,
    clientConfiguration: secrets.clientConfiguration,
    endpoints: [cpIp],
    nodes: [cpIp, workerIp],
  });

  return {
    kubeconfig: pulumi.secret(kubeconfig.kubeconfigRaw),
    talosconfig: pulumi.secret(talosconfig.talosConfig),
    cpIp,
  };
}
