# Provider version pins. Per ADR 0007 (AWS primary).
# Each env's root module should include this via symlink or duplicate.

terraform {
  required_version = ">= 1.5.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

# Default tags applied to every AWS resource.
# Per-env root modules add Env and Owner specifics.
provider "aws" {
  default_tags {
    tags = {
      ManagedBy      = "Terraform"
      Repo           = "KVS-Source/clinwriteai"
      SourceAdr      = "docs/adr/0007-deployment-target.md"
    }
  }
}
