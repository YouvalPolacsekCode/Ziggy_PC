# image/packer/ziggy.pkr.hcl — OPTIONAL golden-image builder for the beta fleet.
#
# Bakes Docker Engine + the Ziggy repo (at a pinned release tag) + host deps into
# an Ubuntu 24.04 cloud image, producing a qcow2 you flash to every mini PC SSD.
# NO per-home secrets are baked — identity is minted per hub at imaging time.
#
# Build:
#   cd image/packer
#   packer init ziggy.pkr.hcl
#   packer build -var "release_tag=v1.0.0" ziggy.pkr.hcl
#
# Requires the QEMU plugin + qemu installed on the build host. For bare-metal
# mini PCs you can instead use Option A (cloud-init) in image/README.md.

packer {
  required_plugins {
    qemu = {
      source  = "github.com/hashicorp/qemu"
      version = ">= 1.0.0"
    }
  }
}

variable "release_tag" {
  type    = string
  default = "v1.0.0"
}
variable "repo_url" {
  type    = string
  default = "https://github.com/YouvalPolacsekCode/ziggy_pc.git"
}
variable "ha_version" {
  type    = string
  default = "2026.6.1"
}
variable "ubuntu_iso_url" {
  type    = string
  default = "https://releases.ubuntu.com/24.04/ubuntu-24.04-live-server-amd64.iso"
}
variable "ubuntu_iso_checksum" {
  type    = string
  # file:https://releases.ubuntu.com/24.04/SHA256SUMS resolves this at build time.
  default = "file:https://releases.ubuntu.com/24.04/SHA256SUMS"
}

source "qemu" "ziggy" {
  iso_url          = var.ubuntu_iso_url
  iso_checksum     = var.ubuntu_iso_checksum
  output_directory = "output-ziggy-hub"
  vm_name          = "ziggy-hub-${var.release_tag}.qcow2"
  format           = "qcow2"
  disk_size        = "20000M"
  memory           = 2048
  cpus             = 2
  headless         = true
  accelerator      = "kvm"
  http_directory   = "${path.root}/../cloud-init"
  boot_wait        = "5s"
  # Drive the autoinstall via the cloud-init seed (user-data/meta-data served
  # over Packer's HTTP server). Adjust boot_command for your Ubuntu autoinstall.
  boot_command = [
    "c<wait>",
    "linux /casper/vmlinuz autoinstall 'ds=nocloud-net;s=http://{{ .HTTPIP }}:{{ .HTTPPort }}/'<enter><wait>",
    "initrd /casper/initrd<enter><wait>",
    "boot<enter>"
  ]
  ssh_username     = "ziggy"
  ssh_timeout      = "40m"
  shutdown_command = "sudo shutdown -P now"
}

build {
  sources = ["source.qemu.ziggy"]

  # Pull the release + pinned container images so first customer boot is offline-fast.
  provisioner "shell" {
    environment_vars = [
      "ZIGGY_RELEASE_TAG=${var.release_tag}",
      "ZIGGY_REPO_URL=${var.repo_url}",
      "HA_VERSION=${var.ha_version}",
    ]
    inline = [
      "set -euo pipefail",
      "command -v docker >/dev/null || (curl -fsSL https://get.docker.com | sudo sh)",
      "sudo mkdir -p /opt/ziggy /etc/ziggy && sudo chmod 700 /etc/ziggy",
      "[ -d /opt/ziggy/.git ] || sudo git clone --branch \"$ZIGGY_RELEASE_TAG\" --depth 1 \"$ZIGGY_REPO_URL\" /opt/ziggy",
      "sudo chown -R ziggy:ziggy /opt/ziggy",
      "sudo docker pull ghcr.io/home-assistant/home-assistant:$HA_VERSION",
      "sudo docker pull eclipse-mosquitto:2.0.20",
      "sudo docker pull koenkk/zigbee2mqtt:2.1.1",
      "pip3 install --break-system-packages cryptography || pip3 install cryptography",
      # Provenance marker (imaging still mints per-home identity separately).
      "echo image_source=packer | sudo tee /etc/ziggy-image/provenance",
    ]
  }

  # Emit provenance/checksums after build (fill version.json downstream).
  post-processor "checksum" {
    checksum_types = ["sha256"]
    output         = "output-ziggy-hub/ziggy-hub-${var.release_tag}.sha256"
  }
}
