variable "example_vm_enabled" {
  description = "Create the example VM. Off by default."
  type        = bool
  default     = false
}

resource "incus_instance" "example_vm" {
  count = var.example_vm_enabled ? 1 : 0

  name  = "example-vm"
  image = "images:ubuntu/24.04"
  type  = "virtual-machine"

  config = {
    "boot.autostart" = true
    "limits.cpu"     = 2
    "limits.memory"  = "2GiB"
  }

  wait_for {
    type = "agent"
  }
}

output "instances" {
  value = {
    for name, i in incus_instance.example_vm : name => {
      status = i.status
      ipv4   = i.ipv4_address
    }
  }
}
