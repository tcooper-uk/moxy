import * as pulumi from "@pulumi/pulumi";
import * as proxmoxve from "@muhlba91/pulumi-proxmoxve";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
// Proxmox provider config — set via:
//   pulumi config set proxmox:endpoint  https://<pve-host>:8006/
//   pulumi config set proxmox:apiToken  'user@realm!tokenid=<uuid>' --secret
//   pulumi config set proxmox:insecure  true          # if using self-signed TLS
const pveCfg = new pulumi.Config("proxmox");

// Application config — set via:
//   pulumi config set moxy:nodeName   <node>
//   pulumi config set moxy:datastore  <datastore>
//   pulumi config set moxy:bridge     vmbr0
const cfg = new pulumi.Config();
const nodeName  = cfg.require("nodeName");
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
    name:          string;
    vmId:          number;
    cores:         number;
    memory:        number;  // MiB
    diskGb:        number;
    // ISO source: provide isoUrl to have Pulumi download it, or isoFileId if
    // the ISO is already present on the node.
    isoUrl?:       string;  // Pulumi will download this to the node
    isoStorageId?: string;  // storage to download into (required when isoUrl is set)
    isoFileId?:    string;  // existing file ID, e.g. "ops:iso/file.iso"
}

const vmSpecs: VmSpec[] = [
    {
        name: "ubuntu-server", vmId: 9001, cores: 2, memory: 4096, diskGb: 32,
        isoFileId: "ops:iso/ubuntu-26.04.1-live-server-amd64.iso",
    },
    {
        name: "alpine-server", vmId: 9002, cores: 2, memory: 2048, diskGb: 16,
        isoUrl:       "https://mirror.vinehost.net/alpine/v3.24/releases/x86_64/alpine-virt-3.24.4-x86_64.iso",
        isoStorageId: "ops",
    },
];

// ---------------------------------------------------------------------------
// Virtual Machines
// ---------------------------------------------------------------------------
const vms = vmSpecs.map((spec) => {
    // Download the ISO if a URL is provided; otherwise use the existing file ID.
    let cdromFileId: pulumi.Input<string>;
    if (spec.isoUrl) {
        const iso = new proxmoxve.download.FileLegacy(`iso-${spec.name}`, {
            contentType:        "iso",
            datastoreId:        spec.isoStorageId!,
            nodeName:           nodeName,
            url:                spec.isoUrl,
            overwriteUnmanaged: true,
        }, { provider });
        // FileLegacy.id is the Pulumi URN; build the Proxmox file ID manually.
        cdromFileId = pulumi.interpolate`${iso.datastoreId}:${iso.contentType}/${iso.fileName}`;
    } else if (spec.isoFileId) {
        cdromFileId = spec.isoFileId;
    } else {
        throw new Error(`VM "${spec.name}": either isoUrl or isoFileId must be set`);
    }

    return new proxmoxve.VmLegacy(spec.name, {
        nodeName: nodeName,
        name:     spec.name,
        vmId:     spec.vmId,

        cpu: {
            cores: spec.cores,
            type:  "x86-64-v2-AES",
        },

        memory: {
            dedicated: spec.memory,
        },

        disks: [{
            datastoreId: datastore,
            interface:   "scsi0",
            size:        spec.diskGb,
        }],

        cdrom: {
            fileId:    cdromFileId,
            interface: "ide3",
        },

        // Tries disk first; falls back to ISO on first boot (blank disk),
        // then boots from disk on subsequent reboots after installation.
        bootOrders: ["scsi0", "ide3"],

        networkDevices: [{
            bridge: bridge,
            model:  "virtio",
        }],

        operatingSystem: {
            type: "l26",
        },

        // Disabled until qemu-guest-agent is installed in the guest.
        agent: {
            enabled: false,
        },

        started: true,
    }, { provider });
});

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
export const vmIds   = vms.map((v) => v.vmId);
export const vmNames = vms.map((v) => v.name);
