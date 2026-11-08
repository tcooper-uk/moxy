# moxy infra

Pulumi TypeScript project that provisions VMs on Proxmox VE.

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- Node.js 18+
- A Proxmox VE node with:
  - An API token with VM permissions (Datacenter → Permissions → API Tokens)
  - The target ISO uploaded to storage (Storage → ISO Images → Upload)

## Setup

```bash
npm install
```

### Configure the stack

```bash
# Proxmox API endpoint
pulumi config set proxmox:endpoint  https://<pve-host>:8006/

# API token — format: user@realm!tokenid=<uuid>
pulumi config set proxmox:apiToken  '<token>' --secret

# Skip TLS verification (set true if using a self-signed cert)
pulumi config set proxmox:insecure  false

# Proxmox node name
pulumi config set moxy:nodeName  <node>

# ISO file ID — format: <storage>:iso/<filename>
pulumi config set moxy:isoFileId  ops:iso/ubuntu-26.04.1-live-server-amd64.iso

# Datastore for VM disks
pulumi config set moxy:datastore  apps

# Network bridge
pulumi config set moxy:bridge  vmbr0
```

## Usage

```bash
# Preview changes
pulumi preview

# Apply
pulumi up

# Destroy
pulumi destroy
```

## VMs

Defined in the `vmSpecs` array in `index.ts`. Add entries there to provision additional VMs.

| Name | VM ID | Cores | Memory | Disk |
|---|---|---|---|---|
| ubuntu-server | 9001 | 2 | 4 GB | 32 GB |

## Notes

- VMs boot from the configured ISO — OS installation is manual (or via autoinstall).
- `agent.enabled` is set to `false` by default. After installing `qemu-guest-agent` in the guest, flip it to `true` and run `pulumi up`.
