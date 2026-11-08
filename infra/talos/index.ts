import * as pulumi from "@pulumi/pulumi";
import * as proxmoxve from "@muhlba91/pulumi-proxmoxve";
import { deployTalosCluster } from "./cluster";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
// Proxmox provider config — set via:
//   pulumi config set proxmox:endpoint  https://<pve-host>:8006/
//   pulumi config set proxmox:apiToken  'user@realm!tokenid=<uuid>' --secret
//   pulumi config set proxmox:insecure  false
const pveCfg = new pulumi.Config("proxmox");

// Application config — set via:
//   pulumi config set moxy:nodeName       <node>
//   pulumi config set moxy:datastore      <vm-disk-storage>   # e.g. apps
//   pulumi config set moxy:bridge         vmbr0
//   pulumi config set moxy:imageStorage   ops
//   pulumi config set moxy:clusterName    moxy
//   pulumi config set moxy:talosVersion   v1.11.2
//   pulumi config set moxy:gateway        192.168.1.1
//   pulumi config set moxy:cidrPrefix     24
//   pulumi config set moxy:dnsServer      192.168.1.1
//   pulumi config set moxy:cpIp           192.168.1.50
//   pulumi config set moxy:workerIp       192.168.1.51
const cfg = new pulumi.Config("moxy");
const nodeName      = cfg.require("nodeName");
const datastore     = cfg.get("datastore") ?? "local-lvm";
const bridge        = cfg.get("bridge") ?? "vmbr0";
const imageStorage  = cfg.require("imageStorage");
const clusterName   = cfg.get("clusterName") ?? "moxy";
const talosVersion  = cfg.require("talosVersion");
const gateway       = cfg.require("gateway");
const cidrPrefix    = cfg.getNumber("cidrPrefix") ?? 24;
const dnsServer     = cfg.require("dnsServer");
const cpIp          = cfg.require("cpIp");
const workerIp      = cfg.require("workerIp");

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
const provider = new proxmoxve.Provider("pve", {
    endpoint: pveCfg.require("endpoint"),
    apiToken: pveCfg.requireSecret("apiToken"),
    insecure: pveCfg.getBoolean("insecure") ?? false,
});

// ---------------------------------------------------------------------------
// Cluster
// ---------------------------------------------------------------------------
const cluster = deployTalosCluster({
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
});

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
// Retrieve after deployment:
//   pulumi stack output kubeconfig  --show-secrets > ~/.kube/moxy.yaml
//   pulumi stack output talosconfig --show-secrets > ~/.talos/moxy.yaml
export const kubeconfig  = cluster.kubeconfig;
export const talosconfig = cluster.talosconfig;
export const controlPlaneIp = cluster.cpIp;
