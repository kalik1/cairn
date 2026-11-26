# Cairn

Cairn is a Ceph storage console for clusters run by
[Rook](https://rook.io), as a [Headlamp](https://headlamp.dev) plugin. It
says whether your data is safe and why, shows every health check with what
it means and what to do, and lets storage administrators run the cluster:
hosts and OSDs, maintenance, flags, pools, RBD images and snapshots, CephFS,
object storage, StorageClasses and CSI, cephx security, Ceph configuration
and logs.

Changes to what Rook owns (pools, file systems, object stores, users,
clients, the storage layout, key rotation) are made by editing Rook's custom
resources, with a YAML diff and a server-side dry run first: Cairn never
fights the operator. Runtime operations Rook does not model (OSD out/in,
flags, scrub, mutes, crash reports, runtime config, RBD snapshots) run as
Ceph commands through the Kubernetes API, under the user's own identity and
RBAC (see [DESIGN.md](https://github.com/kalik1/cairn/blob/main/DESIGN.md)).

Cairn is separate from Hangar and works on any cluster with Rook.

## What you can do

| Area | What you can do |
|---|---|
| Overview | A verdict on data safety in one sentence; every placement group as a cell of a field, by pool and state (keyboard and pointer readout); recovery and backfill progress (degraded and misplaced objects, rates, progress events) |
| Health | Every check expanded: severity, summary, every detail line, since when, muted; a catalog of 87 check codes in plain words (meaning, impact, what to do, Ceph docs link); mute in Ceph with a TTL (optionally sticky) and unmute; mute persistently through Rook (`spec.healthCheck.muteHealthWarning`); past checks |
| Alerts and crashes | Cairn's own alerts (flags set, OSDs down/out or filling before Ceph's near-full, quorum, no standby mgr, crash collector off, CephCluster not Ready, operator down, pools without redundancy, autoscaler); crash reports with details, archive one or all |
| Capacity and performance | Raw, per device class and per pool usable space after replication or erasure coding, with the near-full/backfill-full/full ratios; client throughput, IOPS, recovery and OSD latency charts |
| Hosts and OSDs | Host shelves with a drive bay per OSD; OSD table (class, size, use, PGs, up/down, in/out, weights, latency, node, disk, device id, pod); OSD page with metadata, latency chart and its PGs; mark out/in, reweight, noout, scrub/deep-scrub, with ok-to-stop and safe-to-destroy checks first; the ten cluster flags explained, set and unset; guided host or OSD maintenance (noout, optional out, how to finish); add a disk or a node to the CephCluster storage spec, or change the device filter, with a preview |
| Daemons | Monitors (quorum, leader, ranks, addresses, ciphers, when a restart is safe), managers (active, standbys, modules with enable/disable, services), daemon pods by type with versions and a mixed-version warning, the Rook operator (deployment, image, CephCluster phase, conditions, generation) and the Rook namespace's events; how many managers (1 or 2) and monitors (1, 3 or 5) Rook runs, changed in the CephCluster with a preview: counts the nodes cannot hold are off with the reason, a monitor change waits until every monitor is in quorum, fewer than three monitors on three or more nodes asks for the cluster name; drop a mgr module entry Rook ignores (`rook` on Ceph 20 and later) |
| Pools | Every pool with usage, protection (copies or EC k+m), PGs and autoscaler, compression, quotas, CRUSH rule, live I/O, who manages it and the StorageClasses using it; a pool page with capacity strata, I/O charts, PG states, the Kubernetes side and its CephBlockPool; create (replicated or erasure coded, with an impact panel), change settings (with data-movement warnings), delete (refused while StorageClasses, volumes, images, trash or namespaces use it, and says which) |
| Block (RBD) | Images per pool and RADOS namespace with provisioned and written size, features, parent, snapshots, watchers and the PV, PVC, pod or VM behind each (links to Hangar's VM page); trash (restore, remove, purge expired); an image page with snapshots (create, protect, unprotect, roll back when not in use, delete), clone, flatten, create image, grow, move to trash; CSI-managed images are protected from raw snapshots and offer a Kubernetes VolumeSnapshot instead |
| File (CephFS) | File systems with MDS ranks and standbys, clients, pools, subvolume groups and subvolumes mapped to PVs; create a file system or a subvolume group through Rook; delete refused while volumes use it; says when the CephFS CSI driver is missing |
| Object | Object stores with gateways and endpoints; users (keys hidden; shown on request from the Kubernetes Secret, then hidden again), buckets with usage and quotas, bucket claims; create a store, a user, a bucket StorageClass and a claim; deletes say what blocks them |
| Kubernetes | StorageClasses backed by Ceph in plain words with their volumes and capacity; a wizard (disks for virtual machines: RBD block RWX; filesystem volumes: RBD RWO; shared filesystem: CephFS) with the matching snapshot class; snapshot classes; every Ceph-backed volume with its pool, image or subvolume and consumers; CSI drivers node by node (controller, node plugins, readiness, registration, images, the ceph-csi operator) |
| Security | The CVE-2025-30156 cephx migration as five steps with live status (key types of every entity, monitor ciphers, Rook's cephx status, CSI and kernel readiness); each step as a CephCluster change behind a typed confirmation; the entities and their caps (never keys); CephClients (create with caps presets, rotate, delete) |
| Configuration | Ceph settings by section with search, help and recent changes; set and remove with the exact command and old/new value (settings Rook manages are changed in the CephCluster spec); cluster and audit logs with filters; Kubernetes events; Cairn settings (where commands run, refresh period) and what your role allows |
| Everywhere | Every write is previewed (YAML diff and server-side dry run for Kubernetes objects, the exact command for Ceph) and recorded in Activity; deletes ask for the name; controls your role does not allow are disabled with the reason; the app-bar badge shows Ceph's health on every Headlamp page |

### Not in this version

| What | Why |
|---|---|
| Restarting daemons from Cairn | Rook owns the daemons; Cairn shows how and when a restart is safe instead |
| Per-OSD flags other than noout (noin, nodown, noup per OSD) | Shown, not set: rarely needed, easy to forget set |
| A viewer role with live Ceph data | Needs the mgr prometheus module as a second data source (DESIGN.md, section 8) |
| Editing existing StorageClasses, switching the default class | StorageClass parameters are immutable; changing the default is a cluster-wide choice better made in YAML |
| RBD mirroring, NFS exports, NVMe-oF, multisite object storage screens | Their CRs are read, not managed; mirroring settings are kept when a pool is edited |
| History longer than the page's lifetime | Charts start when Cairn opens and keep an hour; long-term history belongs to Prometheus |


## Access

`distribution/rbac.yaml` has three roles:

| Role | Gives |
|---|---|
| `cairn-viewer` | What Kubernetes knows: Rook resources and their status (Rook's copy of Ceph health and capacity), StorageClasses, snapshot classes, volumes, CSI drivers, Rook pods and events |
| `cairn-editor` | + create, edit and delete Rook resources, StorageClasses, snapshot classes and VolumeSnapshots |
| `cairn-admin` | (bind in the Rook namespace) + Ceph's live state and Ceph operations, through `pods/exec` in the Rook toolbox or operator pod; reading object store user keys on request |

Exec in the Rook namespace holds the Ceph admin keyring: it is the Ceph
administrator role, give it to storage administrators only. Without it
Cairn shows the Kubernetes side and says, where live data would be, which
permission is missing. Controls a role does not allow are disabled with the
reason.

### Fields a platform operator owns

Some platforms apply the CephCluster themselves with server-side apply.
Cairn reads `metadata.managedFields` (from a GET of the CephCluster:
Headlamp's lists leave them out): a field that the k4all operator owns
(field manager `k4all-operator`) is shown read-only with "Managed by
k4all — change it in the k4all addon" and a link to the k4all plugin's
storage settings (`/k4all/settings/storage`) when it is loaded, because the
operator would put its own value back at its next apply. On k4all v2.7.0
that is the Ceph image (`spec.cephVersion.image`, which follows the Rook
release k4all pins); the CephCluster k4all creates once (field manager
`k4all-operator-seed`) is otherwise Cairn's, and the same check covers the
manager count, the monitor count and the mgr module list. Fields written by
anyone else (kubectl, Rook, Headlamp, Cairn) stay editable, and on clusters
without k4all (its API group `k4all.magesgate.com` is not served)
everything is.

Cairn runs Ceph commands in the Rook toolbox (`app=rook-ceph-tools`) when it
runs, else in the Rook operator pod (Configuration → Cairn lets you pick).
No Ceph secret reaches the browser: the program that runs in the pod blanks
keys in every answer and refuses the commands that print them.


## Requirements

| What | For |
|---|---|
| Headlamp v0.46 or newer, in the cluster or as a web app | Cairn is built against `@kinvolk/headlamp-plugin` 0.14.0 (Headlamp v0.46) |
| Rook 1.17 or newer with a CephCluster (tested with Rook 1.21.2 and Ceph 20.2.4 Tentacle) | Everything |
| The Rook toolbox (`app=rook-ceph-tools`) or the Rook operator pod, and `pods/exec` there | Ceph's live state and Ceph operations |
| Ceph-CSI drivers (RBD, CephFS) | Volumes, StorageClasses, snapshots |
| VolumeSnapshot CRDs and a snapshot controller | Snapshot classes and VolumeSnapshots |
| Ceph 20.2.4 / 19.2.6 or newer | The CVE-2025-30156 cephx migration steps |
| [Hangar](https://github.com/kalik1/hangar) (optional) | Links from RBD images to the VMs that use them |

Cairn finds the CephCluster and its namespace (`rook-ceph` is only the
fallback when it sees none), the Rook operator in that namespace or any
other, and the CSI driver names Rook gave the drivers. With several
CephClusters, a picker in Cairn's top bar chooses the one shown.

## Install

The plugin ships as a small OCI image,
`ghcr.io/kalik1/cairn-headlamp-plugin:<version>`, holding
`/plugins/cairn-headlamp-plugin/{main.js,package.json}` (amd64 and arm64),
and as a tarball on each [GitHub Release](https://github.com/kalik1/cairn/releases)
(`cairn-headlamp-plugin-<version>.tar.gz`, with its sha256).

### Headlamp in the cluster (Helm chart)

An initContainer copies the plugin into Headlamp's plugins directory. With
Headlamp's [Helm chart](https://github.com/kubernetes-sigs/headlamp/tree/main/charts/headlamp),
use [`distribution/headlamp-values.yaml`](https://github.com/kalik1/cairn/blob/main/distribution/headlamp-values.yaml)
(trimmed here; the file also sets resources and drops capabilities):

```yaml
config:
  pluginsDir: /headlamp/plugins
initContainers:
  - name: cairn-plugin
    image: ghcr.io/kalik1/cairn-headlamp-plugin:0.1.1
    imagePullPolicy: IfNotPresent
    command: [sh, -c, "cp -R /plugins/cairn-headlamp-plugin/. /cairn-plugin/"]
    securityContext: {runAsNonRoot: true, runAsUser: 100, runAsGroup: 101, readOnlyRootFilesystem: true}
    volumeMounts: [{name: cairn-plugin, mountPath: /cairn-plugin}]
volumes:
  - {name: cairn-plugin, emptyDir: {sizeLimit: 16Mi}}
volumeMounts:
  - {name: cairn-plugin, mountPath: /headlamp/plugins/cairn-headlamp-plugin, readOnly: true}
```

```bash
helm upgrade --install headlamp headlamp/headlamp --namespace headlamp \
  --reuse-values -f distribution/headlamp-values.yaml
```

Helm replaces lists instead of merging them: if your values already have
`initContainers`, `volumes` or `volumeMounts` (other plugins), add these
entries to your lists. A new version arrives with a new image tag, which
rolls Headlamp's pod.

### From the release tarball

Extract `cairn-headlamp-plugin-<version>.tar.gz` (after checking its
sha256) into a folder named `cairn-headlamp-plugin` in Headlamp's plugins
directory; the archive holds `main.js` and `package.json` under one top
folder:

```bash
mkdir -p "$PLUGINS_DIR/cairn-headlamp-plugin"
tar -xzf cairn-headlamp-plugin-0.1.1.tar.gz --strip-components=1 \
  -C "$PLUGINS_DIR/cairn-headlamp-plugin"
```

### Roles

```bash
kubectl apply -f distribution/rbac.yaml
# then bind cairn-viewer / cairn-editor (ClusterRoleBinding) and
# cairn-admin (RoleBinding in the Rook namespace) to your groups
```

See [Access](#access) for what each role gives.

Each [GitHub Release](https://github.com/kalik1/cairn/releases) also
carries these roles as `cairn-cluster.yaml`, for distributions that install
them next to the plugin image of the same version.

### On k4all

[k4all](https://github.com/gpillon/k4all) v2.7.0 and later ship Cairn (the
plugin and `cairn-cluster.yaml`) with the Rook they install, once their
ClusterConfig can turn Rook on. Until then, or with Rook installed by hand,
k4all clusters configure Headlamp through their ClusterConfig, so the plugin
survives k4all upgrades:
[`distribution/k4all-headlamp-overrides.yaml`](https://github.com/kalik1/cairn/blob/main/distribution/k4all-headlamp-overrides.yaml).

```bash
kubectl patch clusterconfig k4all-cluster-config --type merge \
  --patch-file distribution/k4all-headlamp-overrides.yaml
```

Helm lists replace, so the file repeats the k4all plugin's own
initContainer, volume and mount (add Hangar's too if you run it): keep the
tags in step with the k4all release. From k4all v2.7.0 the operator merges
these lists with the release's by name instead, and keeps its own tag of the
plugins it ships. Headlamp must be `Managed` by k4all for the override to
apply.

## URLs

Cairn lives under `/c/<cluster>/ceph`. These stay stable for links from other
plugins (Hangar links datastores and disks here):

| URL | Page |
|---|---|
| `/c/<cluster>/ceph` | Overview |
| `/c/<cluster>/ceph/osds` | Hosts and OSDs (`/ceph/osds/<id>`: one OSD) |
| `/c/<cluster>/ceph/pools/<pool>` | A pool |
| `/c/<cluster>/ceph/rbd/<pool>/<image>` | An RBD image (`/<namespace>` after it for a RADOS namespace) |


## Build

```bash
cd plugin
npm ci
npm run lint && npm run tsc && npm test && npm run build   # dist/main.js
npm run package                                            # the release tarball

# the image, from the repository root
podman build -f Containerfile --build-arg PLUGIN_VERSION=0.1.1 \
  -t ghcr.io/kalik1/cairn-headlamp-plugin:0.1.1 .
```

`npm test` runs `headlamp-plugin test` (vitest with the plugin's own
configuration; plain `vitest run` lacks it).

## Release

1. Set the version in `plugin/package.json` (`npm version <x.y.z>
   --no-git-tag-version` in `plugin/`), in the image tags of `distribution/`
   and in this README; merge to main.
2. Tag main `v<x.y.z>` and push the tag. The
   [release workflow](https://github.com/kalik1/cairn/blob/main/.github/workflows/release.yaml)
   checks that the tag matches the files, runs CI, pushes the image for
   amd64 and arm64, publishes a GitHub Release with the tarball, its sha256,
   its `artifacthub-pkg.yml` and `cairn-cluster.yaml`, and commits that
   metadata to
   `artifacthub/cairn-headlamp-plugin/<x.y.z>/` on main for
   [Artifact Hub](https://artifacthub.io) (repository kind *Headlamp
   plugins*, URL `https://github.com/kalik1/cairn/artifacthub`).
   To claim the listing, set the repository ID from artifacthub.io in
   `artifacthub/artifacthub-repo.yml`.

Design notes: [DESIGN.md](https://github.com/kalik1/cairn/blob/main/DESIGN.md).

## License

GPL-3.0-only: see [LICENSE](https://github.com/kalik1/cairn/blob/main/LICENSE).
