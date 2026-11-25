terraform {
  required_version = ">= 1.6"

  backend "local" {
    path = "/var/lib/tofu/machine1/terraform.tfstate"
  }

  required_providers {
    incus = {
      source  = "lxc/incus"
      version = "~> 1.2"
    }
  }
}

provider "incus" {}
