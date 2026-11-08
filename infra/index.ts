import * as pulumi from "@pulumi/pulumi";
import * as proxmoxve from "@muhlba91/pulumi-proxmoxve";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
// Proxmox provider config — set via:
//   pulumi config set proxmox:endpoint  https://<pve-host>:8006/
//   pulumi config set proxmox:apiToken  'root@pam!pulumi=<uuid>' --secret
//   pulumi config set proxmox:insecure  true          # if using self-signed TLS
const pveCfg = new pulumi.Config("proxmox");

// Application config — set via:
//   pulumi config set moxy:nodeName   pve
//   pulumi config set moxy:isoFileId  local:iso/ubuntu-24.04-live-server-amd64.iso
//   pulumi config set moxy:datastore  local-lvm
//   pulumi config set moxy:bridge     vmbr0
const cfg = new pulumi.Config();
const nodeName  = cfg.require("nodeName");
const isoFileId = cfg.require("isoFileId");
const datastore = cfg.get("datastore") ?? "local-lvm";
const bridge    = cfg.get("bridge") ?? "vmbr0";

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
const provider = new proxmoxve.Provider("pve", {
    endpoint: pveCfg.require("endpoint"),
    apiToken: pveCfg.requireSecret("apiToken"),
    insecure: pveCfg.getBoolean("insecure") ?? false,
});

// ---------------------------------------------------------------------------
// VM specs — add more entries here to provision additional VMs
// ---------------------------------------------------------------------------
interface VmSpec {
    name:    string;
    vmId:    number;
    cores:   number;
    memory:  number;  // MiB
    diskGb:  number;
}

const vmSpecs: VmSpec[] = [
    { name: "ubuntu-server", vmId: 9001, cores: 2, memory: 4096, diskGb: 32 },
];

// ---------------------------------------------------------------------------
// Virtual Machines
// ---------------------------------------------------------------------------
const vms = vmSpecs.map((spec) =>
    new proxmoxve.VmLegacy(spec.name, {
        nodeName: nodeName,
        name:     spec.name,
        vmId:     spec.vmId,

        cpu: {
            cores: spec.cores,
            type:  "x86-64-v2-AES",   // recommended for modern hosts
        },

        memory: {
            dedicated: spec.memory,
        },

        // Blank system disk — the OS will be installed here from the ISO
        disks: [{
            datastoreId: datastore,
            interface:   "scsi0",
            size:        spec.diskGb,
        }],

        // ISO to boot from.  fileId format: "<storage>:iso/<filename>"
        // e.g. local:iso/ubuntu-24.04-live-server-amd64.iso
        // The ISO must already exist on the Proxmox node (upload via UI or
        // set moxy:isoFileId to a proxmoxve.download.FileLegacy resource id).
        cdrom: {
            fileId:    isoFileId,
            interface: "ide3",    // default CD-ROM slot
        },

        // Boot CD first so the installer runs, then fall through to disk
        bootOrders: ["ide3", "scsi0"],

        networkDevices: [{
            bridge: bridge,
            model:  "virtio",
        }],

        operatingSystem: {
            type: "l26",    // Linux 2.6+ / modern kernel
        },

        // Keep the QEMU agent disabled until the OS is installed and
        // qemu-guest-agent is running — otherwise pulumi up will hang.
        agent: {
            enabled: false,
        },

        started: true,
    }, { provider }),
);

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
export const vmIds   = vms.map((v) => v.vmId);
export const vmNames = vms.map((v) => v.name);
