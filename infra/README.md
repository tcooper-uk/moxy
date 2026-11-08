# moxy infra

Pulumi TypeScript projects that provision infrastructure on Proxmox VE.

```
infra/
  dev/     — general-purpose test VMs
  talos/   — Talos Linux Kubernetes cluster (1 control-plane + 1 worker)
```

Each subdirectory is an independent Pulumi project with its own state and config.

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- Node.js 18+
- A Proxmox VE node with an API token (Datacenter → Permissions → API Tokens)

---

## dev

General-purpose VMs booted from ISOs. ISOs can be pre-existing on the node or downloaded by Pulumi.

### Setup

```bash
cd dev
npm install
pulumi stack init dev

pulumi config set proxmox:endpoint  https://<pve-host>:8006/
pulumi config set proxmox:apiToken  '<user@realm!tokenid=uuid>' --secret
pulumi config set proxmox:insecure  false

pulumi config set moxy:nodeName   <node>
pulumi config set moxy:datastore  apps
pulumi config set moxy:bridge     vmbr0
```

### VMs

Defined in the `vmSpecs` array in `dev/index.ts`.

| Name | VM ID | Cores | Memory | Disk | ISO source |
|---|---|---|---|---|---|
| ubuntu-server | 9001 | 2 | 4 GB | 32 GB | existing on node |
| alpine-server | 9002 | 2 | 2 GB | 16 GB | downloaded via Pulumi |

Each VM spec supports two ISO sources:

- `isoUrl` + `isoStorageId` — Pulumi downloads the ISO to the node's storage before creating the VM.
- `isoFileId` — ISO already present on the node (`<storage>:iso/<filename>`).

### Notes

- VMs boot disk-first; on first boot the blank disk fails and falls back to the ISO. Subsequent reboots go straight to the installed OS.
- `agent.enabled` is `false` by default. After installing `qemu-guest-agent` in the guest, flip it to `true` and run `pulumi up`.

---

## talos

Automated Talos Linux Kubernetes cluster using [Image Factory](https://factory.talos.dev/) and the `@pulumiverse/talos` provider. A single `pulumi up` downloads the Talos image, creates the VMs, applies machine configs, bootstraps etcd, and exports the kubeconfig.

### Setup

```bash
cd talos
npm install
pulumi stack init dev

pulumi config set proxmox:endpoint  https://<pve-host>:8006/
pulumi config set proxmox:apiToken  '<user@realm!tokenid=uuid>' --secret
pulumi config set proxmox:insecure  false

pulumi config set moxy:nodeName      <node>
pulumi config set moxy:datastore     apps
pulumi config set moxy:bridge        vmbr0
pulumi config set moxy:imageStorage  ops
pulumi config set moxy:clusterName   moxy
pulumi config set moxy:talosVersion  v1.9.5
pulumi config set moxy:gateway       10.0.1.1
pulumi config set moxy:cidrPrefix    24
pulumi config set moxy:dnsServer     10.0.1.1
pulumi config set moxy:cpIp          10.0.1.2
pulumi config set moxy:workerIp      10.0.1.3
```

IPs must be outside your DHCP pool and stable — the control-plane IP is baked into the cluster PKI.

### Nodes

| Name | VM ID | Role | Cores | Memory | Disk | IP |
|---|---|---|---|---|---|---|
| moxy-cp-1 | 9101 | control-plane | 2 | 4 GB | 20 GB | `moxy:cpIp` |
| moxy-worker-1 | 9102 | worker | 2 | 4 GB | 20 GB | `moxy:workerIp` |

### Outputs

```bash
# Export kubeconfig
pulumi stack output kubeconfig --show-secrets > ~/.kube/moxy.yaml

# Export talosconfig
pulumi stack output talosconfig --show-secrets > ~/.talos/config

# Verify cluster
kubectl --kubeconfig ~/.kube/moxy.yaml get nodes
```

### Notes

- The Talos nocloud ISO is downloaded from Image Factory with the `qemu-guest-agent` extension baked in.
- Static IPs are set in both Proxmox cloud-init (for the initial maintenance-mode boot) and in the Talos machine config (so they persist after install and reboot).
- Boot order is disk-first: blank disk on first boot falls back to ISO (maintenance mode + config apply + install); after install the disk is used directly.
- Scaling to more workers: add entries in `cluster.ts` using the `makeNode` helper, each with a unique IP and VM ID.

---

## Usage (either project)

```bash
pulumi preview   # dry run
pulumi up        # apply
pulumi destroy   # tear down
```
