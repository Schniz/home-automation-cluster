# machine1 workspace (OpenTofu + Incus)

Manages Incus system containers and VMs on machine1. Docker services stay in `docker-compose.yml`.

Ansible (`ansible/main.yaml`) installs OpenTofu and applies this workspace.

## Setup on the host

1. Install Incus and initialize it:

   ```sh
   sudo apt install incus
   sudo incus admin init
   ```

2. Run the playbook, or apply by hand from this directory:

   ```sh
   tofu init
   tofu plan
   tofu apply
   ```

## Web UI

Incus serves a web UI on HTTPS. Install the UI package and bind the listener:

```sh
sudo apt install incus-ui-canonical
incus config set core.https_address :8443
```

Open `https://<host>:8443` to see instance status (running, stopped, IP) and manage instances.
Trust the client certificate when prompted, or add one with `incus config trust add`.

## State

State is local: `/var/lib/tofu/machine1/terraform.tfstate`, owned by the runner user. It lives outside the repo, so checkouts can't delete it. Back it up to `/media/SchlezExt`. Do not commit it.

## Plan on PR

`.github/workflows/tofu-plan.yml` runs `tofu plan` on PRs that touch `tofu/**`. Runs `tofu plan` on PRs that touch `tofu/**`. It waits for approval in the `home` environment, the same one the deploy uses, then posts the plan as a PR comment. Fork PRs are skipped.

## Usage

Create the example VM:

```sh
tofu apply -var example_vm_enabled=true
```

Show status of all managed VMs:

```sh
tofu output instances
```
