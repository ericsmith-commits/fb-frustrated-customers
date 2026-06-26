# fb-frustrated-customers

GitHub target:

- `git@github.com:ericsmith-commits/fb-frustrated-customers.git`

Remote host:

- IP: `198.199.70.201`
- SSH alias: `social`
- SSH config: `./ssh_config`
- Private key: `~/.ssh/social_do_ed25519`

## First-time SSH setup

Add this public key to `/root/.ssh/authorized_keys` on the DigitalOcean droplet:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPhAv1jAQdNajZhfpA/cMAKDnq7cGYFDP/sT2hp1tfDF social-digitalocean
```

From the DigitalOcean web console, run:

```sh
mkdir -p /root/.ssh
chmod 700 /root/.ssh
printf '%s\n' 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPhAv1jAQdNajZhfpA/cMAKDnq7cGYFDP/sT2hp1tfDF social-digitalocean' >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
```

Then test from this project:

```sh
ssh -F ./ssh_config social whoami
```

Or use the helper:

```sh
./scripts/remote whoami
```
