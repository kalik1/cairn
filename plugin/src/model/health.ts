/*
 * Ceph health in plain words: a catalog of the common health checks (what
 * it means, what it does to data and clients, what to do, the Ceph docs),
 * the verdict about data safety the overview leads with, and the mute
 * commands.
 */

import type { View } from '../shell/nav';
import type { StateTone } from '../ui/tokens';
import { pct, plural } from './format';
import { countsFromStates, PgCounts } from './pg';
import { ClusterStatus, Health, HealthCheck } from './types';

export interface CheckInfo {
  /** A plain title ("OSDs are down"). */
  title: string;
  /** What Ceph is saying. */
  meaning: string;
  /** What it does to data and clients. */
  impact: string;
  /** What to do, in order. */
  todo: string[];
  /** Where in Cairn to look or fix it. */
  link?: { view: View; a?: string; label: string };
  /** Docs page when not the RADOS health-check list (CephFS checks). */
  docs?: string;
  /** Anchor on the health-check page when it is not the code (OSD_<type>_DOWN). */
  anchor?: string;
  /** Why this check should not be muted. */
  noMute?: string;
}

const HC = 'https://docs.ceph.com/en/latest/rados/operations/health-checks/';
const FS_DOCS = 'https://docs.ceph.com/en/latest/cephfs/health-messages/';

const OSDS = { view: 'osds' as View, label: 'Open Hosts & OSDs' };
const MONS = { view: 'daemons' as View, a: 'mons', label: 'Open Monitors' };
const MGR = { view: 'daemons' as View, a: 'mgr', label: 'Open Managers' };
const POOLS = { view: 'pools' as View, label: 'Open Pools' };
const FS = { view: 'cephfs' as View, label: 'Open File systems' };
const SEC = { view: 'security' as View, label: 'Open Security' };
const PODS = { view: 'daemons' as View, a: 'daemons', label: 'Open Daemon pods' };
const OBJ = { view: 'object' as View, label: 'Open Object storage' };
const CONF = { view: 'config' as View, label: 'Open Configuration' };

export const HEALTH_CATALOG: Record<string, CheckInfo> = {
  /* -------------------------------------------------------------- monitors */
  MON_DOWN: {
    title: 'A monitor is down',
    meaning: 'One or more monitors are not in quorum.',
    impact:
      'The cluster keeps working while a majority of monitors is up. Losing one more may stop it: no new client connections, no map changes, I/O eventually blocks.',
    todo: [
      'Look at the monitor pod and its node (Daemons, Monitors).',
      'Check the disk under the Rook data directory on that node (/var/lib/rook): monitors stop when it is nearly full.',
      'Rook replaces a monitor that stays down longer than its failover timeout (healthCheck.daemonHealth.mon.timeout, 10 min by default).',
    ],
    link: MONS,
  },
  MON_CLOCK_SKEW: {
    title: 'Monitor clocks disagree',
    meaning: 'The clocks of the nodes running monitors differ by more than mon_clock_drift_allowed (0.05 s).',
    impact: 'Elections and leases can fail; the monitors may lose quorum.',
    todo: ['Fix time synchronisation (chrony or NTP) on the nodes that run monitors.', 'The check clears on its own once the clocks agree.'],
    link: MONS,
  },
  MON_MSGR2_NOT_ENABLED: {
    title: 'Monitors do not speak msgr2',
    meaning: 'Some monitors are not listening on the msgr2 port (3300), the protocol with encryption and better authentication.',
    impact: 'Clients and daemons fall back to the legacy v1 protocol.',
    todo: ['Run "ceph mon enable-msgr2" (Rook normally does it), and check spec.network.connections in the CephCluster.'],
    link: MONS,
  },
  MON_DISK_LOW: {
    title: 'Monitor disk is filling up',
    meaning: 'A monitor’s data directory has less than mon_data_avail_warn (30%) free.',
    impact: 'At mon_data_avail_crit (5%) the monitor stops to protect its database.',
    todo: ['Free space on that node under the Rook data directory (dataDirHostPath, /var/lib/rook).', 'If the monitor store is large, see MON_DISK_BIG.'],
    link: MONS,
  },
  MON_DISK_CRIT: {
    title: 'Monitor disk is almost full',
    meaning: 'A monitor’s data directory has less than mon_data_avail_crit (5%) free.',
    impact: 'The monitor shuts down. With others down too, the cluster stops.',
    todo: ['Free space on that node now (logs, images, other data on the same filesystem).'],
    link: MONS,
  },
  MON_DISK_BIG: {
    title: 'Monitor database is large',
    meaning: 'A monitor’s database is bigger than mon_data_size_warn (15 GiB).',
    impact: 'Slow elections and restarts. It usually grows while placement groups stay unclean for a long time.',
    todo: ['Let the cluster become clean: monitors trim old maps then.', 'Compact it with "ceph tell mon.<id> compact".'],
    link: MONS,
  },
  MON_NETSPLIT: {
    title: 'Monitors cannot all reach each other',
    meaning: 'A network partition separates some monitors while each still sees others.',
    impact: 'Quorum may flap; clients may see stalls.',
    todo: ['Check the network between the monitor nodes (pod network, firewall, MTU).'],
    link: MONS,
  },
  DAEMON_OLD_VERSION: {
    title: 'Daemons run different Ceph versions',
    meaning: 'Some daemons have run an older version for longer than mon_warn_older_version_delay (a week).',
    impact: 'Mixed versions are expected during an upgrade, not for weeks; new features stay off.',
    todo: ['Finish the upgrade: check the Rook operator and the CephCluster cephVersion image (Daemons, Rook operator).'],
    link: PODS,
  },

  /* -------------------------------------------------------------- managers */
  MGR_DOWN: {
    title: 'No active manager',
    meaning: 'Every ceph-mgr daemon is down.',
    impact:
      'Client I/O continues, but statistics go stale, the dashboard and Prometheus metrics stop, and the autoscaler, balancer and crash reports stop.',
    todo: ['Look at the mgr pods (Daemons, Managers).', 'Run two managers (spec.mgr.count: 2) so a standby takes over.'],
    link: MGR,
  },
  MGR_MODULE_DEPENDENCY: {
    title: 'A manager module cannot run',
    meaning: 'An enabled mgr module is missing a dependency (a Python package, a setting).',
    impact: 'Only that module’s feature is lost.',
    todo: ['The detail names the module and what is missing.', 'Disable the module if you do not need it (Daemons, Managers).'],
    link: MGR,
  },
  MGR_MODULE_ERROR: {
    title: 'A manager module failed',
    meaning: 'An enabled mgr module hit an unexpected error.',
    impact: 'Only that module’s feature is lost until it is fixed.',
    todo: ['Read the error in the detail and the mgr pod logs.', 'A manager failover ("ceph mgr fail") often restarts the module cleanly.'],
    link: MGR,
  },
  RECENT_MGR_MODULE_CRASH: {
    title: 'A manager module crashed recently',
    meaning: 'A mgr module crashed in the last two weeks and the report is not archived.',
    impact: 'The module may be stopped or unreliable.',
    todo: ['Read the crash report below, then archive it.'],
  },

  /* ------------------------------------------------------------------ OSDs */
  OSD_DOWN: {
    title: 'OSDs are down',
    meaning: 'Some OSDs are marked down: their daemons stopped answering.',
    impact:
      'Their placement groups run on fewer copies (degraded). After mon_osd_down_out_interval (10 min) Ceph marks them out and starts rebuilding the copies elsewhere.',
    todo: [
      'Look at the OSD pods and their nodes (Hosts & OSDs).',
      'For planned work, set noout first so Ceph waits instead of moving data.',
      'A disk that failed: replace it, then let Rook create the new OSD.',
    ],
    link: OSDS,
  },
  OSD_HOST_DOWN: {
    title: 'Every OSD of a host is down',
    meaning: 'All OSDs under a CRUSH host bucket are down: usually the node itself is down or cut off.',
    impact: 'A whole failure domain is missing: every placement group with a copy there is degraded.',
    todo: ['Check the Kubernetes node (Ready, network, power).', 'For planned maintenance use the host maintenance flow in Hosts & OSDs.'],
    link: OSDS,
    anchor: 'osd-crush-type-down',
  },
  OSD_ORPHAN: {
    title: 'CRUSH lists an OSD that does not exist',
    meaning: 'An OSD is in the CRUSH map but not in the OSD map.',
    impact: 'None for data; the map is untidy.',
    todo: ['Remove it with "ceph osd crush rm osd.<id>".'],
    link: OSDS,
  },
  OSD_OUT_OF_ORDER_FULL: {
    title: 'Full ratios are out of order',
    meaning: 'The thresholds must rise: nearfull < backfillfull < full < failsafe full.',
    impact: 'Ceph may block writes or data movement at unexpected points.',
    todo: ['Set them in the CephCluster (spec.storage.nearFullRatio, backfillFullRatio, fullRatio) so Rook keeps them.'],
    link: OSDS,
  },
  OSD_FULL: {
    title: 'An OSD is full',
    meaning: 'One or more OSDs passed the full ratio.',
    impact: 'Ceph stops accepting writes to every pool that uses these OSDs. Data is safe; clients block or fail on write.',
    todo: [
      'Add capacity (a disk or node) or delete data.',
      'To delete data you may raise the full ratio a little for a short time ("ceph osd set-full-ratio 0.96"), then put it back.',
    ],
    link: OSDS,
  },
  OSD_BACKFILLFULL: {
    title: 'An OSD is too full to receive data',
    meaning: 'One or more OSDs passed the backfillfull ratio.',
    impact: 'Ceph will not move data onto them: rebalancing and recovery towards them stall.',
    todo: ['Add capacity, delete data, or move data away (balancer, reweight).'],
    link: OSDS,
  },
  OSD_NEARFULL: {
    title: 'An OSD is nearly full',
    meaning: 'One or more OSDs passed the nearfull ratio.',
    impact: 'Nothing blocks yet. At backfillfull data stops moving to them; at full writes stop.',
    todo: ['Add capacity before they reach full.', 'If only some OSDs are full, even them out (balancer on, or reweight).'],
    link: OSDS,
  },
  OSDMAP_FLAGS: {
    title: 'Cluster flags are set',
    meaning: 'Flags such as noout, norebalance or noscrub change how the whole cluster behaves.',
    impact: 'Depends on the flag: noout stops self-healing, pause stops all I/O, noscrub skips data checks.',
    todo: ['Unset the flags when the work that needed them is done (Hosts & OSDs, Cluster flags).'],
    link: OSDS,
  },
  OSD_FLAGS: {
    title: 'OSDs or hosts have flags',
    meaning: 'Flags such as noout are set on single OSDs or CRUSH buckets.',
    impact: 'Those OSDs will not be marked out (or in, up, down) automatically.',
    todo: ['Clear them when the maintenance is done (Hosts & OSDs).'],
    link: OSDS,
  },
  OLD_CRUSH_TUNABLES: {
    title: 'CRUSH uses old tunables',
    meaning: 'The CRUSH map uses tunables older than mon_crush_min_required_version.',
    impact: 'Less even data placement.',
    todo: ['"ceph osd crush tunables optimal" fixes it but moves a lot of data: plan it.'],
  },
  OSD_UPGRADE_FINISHED: {
    title: 'The upgrade is not marked finished',
    meaning: 'All OSDs run a newer release, but require_osd_release is still the old one.',
    impact: 'Features of the new release stay off.',
    todo: ['Rook sets it after an upgrade; otherwise run "ceph osd require-osd-release <release>".'],
  },
  OSD_NO_DOWN_OUT_INTERVAL: {
    title: 'Down OSDs are never marked out',
    meaning: 'mon_osd_down_out_interval is 0.',
    impact: 'Ceph never rebuilds the copies of a failed OSD on its own.',
    todo: ['Remove the override unless you do it on purpose ("ceph config rm mon mon_osd_down_out_interval").'],
    link: CONF,
  },
  OSD_TOO_MANY_REPAIRS: {
    title: 'An OSD repairs too many read errors',
    meaning: 'An OSD had to repair more read errors than mon_osd_warn_num_repaired.',
    impact: 'The disk is likely failing.',
    todo: ['Check the disk health (SMART) and plan to replace it: mark the OSD out to move its data first.'],
    link: OSDS,
  },
  OSD_SLOW_PING_TIME_BACK: {
    title: 'Slow network between OSDs (cluster network)',
    meaning: 'Heartbeats between OSDs on the back (cluster) network take longer than 1 s.',
    impact: 'Replication and recovery slow down; OSDs may be marked down by mistake.',
    todo: ['Check the network between the OSD nodes (links, MTU, congestion).'],
    link: OSDS,
  },
  OSD_SLOW_PING_TIME_FRONT: {
    title: 'Slow network between OSDs (public network)',
    meaning: 'Heartbeats between OSDs on the front (public) network take longer than 1 s.',
    impact: 'Client I/O slows; OSDs may be marked down by mistake.',
    todo: ['Check the public network of the OSD nodes.'],
    link: OSDS,
  },
  OSD_SCRUB_ERRORS: {
    title: 'Scrubs found errors',
    meaning: 'Scrubbing found copies that do not match.',
    impact: 'Some objects have a bad copy; the good copies are still readable.',
    todo: [
      'Find the placement groups: "ceph health detail" lists them (see PG_DAMAGED).',
      'Inspect with "rados list-inconsistent-obj <pgid>", fix the cause (often a failing disk), then "ceph pg repair <pgid>".',
    ],
    link: OSDS,
  },

  /* ------------------------------------------------------------- BlueStore */
  BLUESTORE_SLOW_OP_ALERT: {
    title: 'Slow BlueStore operations',
    meaning: 'OSDs logged BlueStore operations slower than expected.',
    impact: 'Client I/O on those OSDs is slow.',
    todo: ['Check the disks of the named OSDs (latency, SMART, controller).'],
    link: OSDS,
  },
  BLUESTORE_DISK_SIZE_MISMATCH: {
    title: 'OSD disk size changed',
    meaning: 'The device under an OSD has a different size from what BlueStore recorded.',
    impact: 'The OSD may fail or crash.',
    todo: ['Redeploy the OSD (remove it, wipe the disk, let Rook create it again).'],
    link: OSDS,
  },
  BLUESTORE_FRAGMENTATION: {
    title: 'OSD free space is fragmented',
    meaning: 'BlueStore’s free space is scattered in small pieces.',
    impact: 'Writes slow down.',
    todo: ['Redeploying the OSD defragments it; plan it one OSD at a time.'],
    link: OSDS,
  },
  BLUEFS_SPILLOVER: {
    title: 'OSD metadata spilled to the slow device',
    meaning: 'The RocksDB metadata no longer fits the fast DB device and spills onto the main disk.',
    impact: 'Metadata operations slow down.',
    todo: ['Use a larger DB device for those OSDs (redeploy them).'],
    link: OSDS,
  },
  BLUEFS_AVAILABLE_SPACE: {
    title: 'Little space left for OSD metadata',
    meaning: 'BlueFS, where RocksDB lives, has little space left.',
    impact: 'The OSD may stop when it runs out.',
    todo: ['Free space (delete data, compact) or give the OSD more space.'],
    link: OSDS,
  },
  BLUEFS_LOW_SPACE: {
    title: 'OSD metadata space is low',
    meaning: 'BlueFS is running low on space.',
    impact: 'The OSD may stop when it runs out.',
    todo: ['Free space or give the OSD more space.'],
    link: OSDS,
  },
  BLUESTORE_NO_COMPRESSION: {
    title: 'Compression unavailable on OSDs',
    meaning: 'OSDs cannot load the compression plugin configured for a pool.',
    impact: 'Data is written uncompressed.',
    todo: ['Check the compression algorithm of the pool against the plugins of the Ceph image.'],
    link: POOLS,
  },
  BLUESTORE_SPURIOUS_READ_ERRORS: {
    title: 'OSDs saw read errors that went away on retry',
    meaning: 'Reads from the disk failed, then succeeded when retried.',
    impact: 'Often an early sign of a failing disk, cable or controller.',
    todo: ['Check the disk and controller of the named OSDs.'],
    link: OSDS,
  },
  BLUESTORE_NO_PER_POOL_OMAP: {
    title: 'OSDs use the legacy omap layout',
    meaning: 'OSDs created before Octopus keep omap usage per OSD, not per pool.',
    impact: 'Per-pool omap statistics are inaccurate.',
    todo: ['Convert with a repair run of each stopped OSD (ceph-bluestore-tool repair), or redeploy them.'],
    link: OSDS,
  },

  /* --------------------------------------------------------------- devices */
  DEVICE_HEALTH: {
    title: 'A disk is expected to fail',
    meaning: 'Device health monitoring predicts that some disks will fail soon.',
    impact: 'Data on them is still safe; a failure would degrade its placement groups.',
    todo: ['Mark the OSDs on those disks out so Ceph moves the data off, then replace the disks.'],
    link: OSDS,
  },
  DEVICE_HEALTH_IN_USE: {
    title: 'A failing disk still holds data',
    meaning: 'Disks expected to fail are marked out, but data is still being moved off them.',
    impact: 'Wait: Ceph is moving the data.',
    todo: ['Let the migration finish before removing the disks.'],
    link: OSDS,
  },
  DEVICE_HEALTH_TOOMANY: {
    title: 'Too many disks are expected to fail',
    meaning: 'Marking out every failing disk would leave fewer OSDs in than mon_osd_min_in_ratio.',
    impact: 'Ceph will not mark them out on its own.',
    todo: ['Add capacity, then replace the disks one by one.'],
    link: OSDS,
  },

  /* ---------------------------------------------------- placement groups */
  PG_AVAILABILITY: {
    title: 'Some data is unavailable',
    meaning: 'Some placement groups are inactive (down, incomplete, stale, peering for long).',
    impact: 'Reads and writes to the objects in them wait until they become active again.',
    todo: [
      'Bring back the OSDs those placement groups need: the detail lists them, "ceph pg <pgid> query" tells which OSD they wait for.',
      'Do not remove or wipe down OSDs while placement groups are incomplete.',
    ],
    link: OSDS,
  },
  PG_DEGRADED: {
    title: 'Some data is not fully replicated',
    meaning: 'Some objects have fewer copies than their pool wants, usually because OSDs are down or out.',
    impact: 'Data is readable; one more failure in the same placement groups could make it unavailable.',
    todo: ['Ceph recovers on its own when the OSDs come back or are marked out.', 'If it does not progress, look for down OSDs and full OSDs.'],
    link: OSDS,
  },
  PG_RECOVERY_FULL: {
    title: 'Recovery is blocked: OSDs are full',
    meaning: 'Placement groups cannot recover because target OSDs passed the full ratio.',
    impact: 'Data stays degraded.',
    todo: ['Add capacity or delete data.'],
    link: OSDS,
  },
  PG_BACKFILL_FULL: {
    title: 'Data movement is blocked: OSDs are too full',
    meaning: 'Placement groups cannot backfill because target OSDs passed the backfillfull ratio.',
    impact: 'Data stays misplaced or degraded.',
    todo: ['Add capacity, delete data, or move data away from the full OSDs.'],
    link: OSDS,
  },
  PG_DAMAGED: {
    title: 'Some copies disagree',
    meaning: 'Scrubbing found inconsistent placement groups, or objects Ceph cannot find.',
    impact: 'Good copies are readable; the bad ones need a repair.',
    todo: [
      'Inspect with "rados list-inconsistent-obj <pgid> --format=json-pretty".',
      'Fix the cause (often a failing disk), then run "ceph pg repair <pgid>".',
    ],
    link: OSDS,
  },
  PG_NOT_SCRUBBED: {
    title: 'Placement groups were not scrubbed in time',
    meaning: 'Some placement groups were not scrubbed within osd_scrub_max_interval.',
    impact: 'Silent problems in their copies would go unnoticed for longer.',
    todo: ['Check the noscrub flag and scrub settings (osd_max_scrubs, scrub hours).', 'You can scrub an OSD now from Hosts & OSDs.'],
    link: OSDS,
  },
  PG_NOT_DEEP_SCRUBBED: {
    title: 'Placement groups were not deep-scrubbed in time',
    meaning: 'Some placement groups were not deep-scrubbed within osd_deep_scrub_interval.',
    impact: 'Bit rot on disk would go unnoticed for longer.',
    todo: ['Check the nodeep-scrub flag and scrub settings.', 'You can deep-scrub an OSD now from Hosts & OSDs.'],
    link: OSDS,
  },
  PG_SLOW_SNAP_TRIMMING: {
    title: 'Snapshot cleanup is behind',
    meaning: 'The queue of snapshots to trim is long for some placement groups.',
    impact: 'Space from deleted snapshots is freed slowly.',
    todo: ['Check OSD load; trimming speeds up when the OSDs are less busy (osd_snap_trim_sleep).'],
  },
  OBJECT_MISPLACED: {
    title: 'Data is being rebalanced',
    meaning: 'Some objects are not where CRUSH wants them; they still have all their copies.',
    impact: 'None for safety. Data movement uses disk and network.',
    todo: ['Nothing: Ceph moves them. If it does not progress, check norebalance, nobackfill and full OSDs.'],
    link: OSDS,
  },
  OBJECT_UNFOUND: {
    title: 'Some objects cannot be found',
    meaning: 'Ceph knows objects exist but cannot reach any up-to-date copy of them.',
    impact: 'Reads and writes to those objects block. If the copies are gone, the data is lost.',
    todo: [
      'Bring back every OSD that was down: the copies are usually there.',
      'List them with "ceph pg <pgid> list_unfound". Marking them lost is the last resort and loses data.',
    ],
    link: OSDS,
  },
  SLOW_OPS: {
    title: 'Requests are slow',
    meaning: 'Some OSD or monitor requests take longer than osd_op_complaint_time (30 s).',
    impact: 'Clients see stalls: virtual machines freeze, applications time out.',
    todo: ['The detail names the daemons: check their disks, network and load.', 'One slow disk can slow a whole pool.'],
    link: OSDS,
  },
  LARGE_OMAP_OBJECTS: {
    title: 'Some objects have very large metadata',
    meaning: 'Deep scrub found objects whose omap is above the warning size, often an RGW bucket index.',
    impact: 'Slow recovery and scrubs; possible stalls.',
    todo: ['For RGW, reshard the bucket ("radosgw-admin bucket reshard").'],
    link: OBJ,
  },

  /* ---------------------------------------------------------------- pools */
  POOL_FULL: {
    title: 'A pool is full',
    meaning: 'A pool reached its quota, or the OSDs it uses are full.',
    impact: 'Writes to the pool stop.',
    todo: ['Raise or remove the quota, delete data, or add capacity.'],
    link: POOLS,
  },
  POOL_NEAR_FULL: {
    title: 'A pool is nearly full',
    meaning: 'A pool is close to its quota, or its OSDs are nearly full.',
    impact: 'Nothing blocks yet.',
    todo: ['Raise the quota or add capacity before it fills.'],
    link: POOLS,
  },
  POOL_NO_REDUNDANCY: {
    title: 'A pool keeps a single copy',
    meaning: 'Some pools have size 1.',
    impact: 'Losing one OSD loses data in those pools.',
    todo: ['Set the pool size to 3 (CephBlockPool spec.replicated.size) unless the data is disposable.'],
    link: POOLS,
  },
  POOL_APP_NOT_ENABLED: {
    title: 'A pool has no application',
    meaning: 'A pool is not tagged for rbd, cephfs or rgw.',
    impact: 'None for data; clients of some tools refuse it.',
    todo: ['Tag it: "ceph osd pool application enable <pool> rbd" (Rook does it for its own pools).'],
    link: POOLS,
  },
  POOL_TOO_FEW_PGS: {
    title: 'A pool needs more placement groups',
    meaning: 'The autoscaler thinks the pool should have more placement groups.',
    impact: 'Data spreads less evenly; performance may suffer.',
    todo: ['Turn the autoscaler on for the pool, or raise pg_num.'],
    link: POOLS,
  },
  POOL_TOO_MANY_PGS: {
    title: 'A pool has more placement groups than needed',
    meaning: 'The autoscaler thinks the pool should have fewer placement groups.',
    impact: 'More memory and CPU per OSD than needed.',
    todo: ['Turn the autoscaler on for the pool, or lower pg_num.'],
    link: POOLS,
  },
  TOO_FEW_PGS: {
    title: 'Too few placement groups',
    meaning: 'There are fewer placement groups per OSD than mon_pg_warn_min_per_osd.',
    impact: 'Data spreads unevenly over the OSDs.',
    todo: ['Let the autoscaler raise pg_num, or raise it on the largest pools.'],
    link: POOLS,
  },
  TOO_MANY_PGS: {
    title: 'Too many placement groups per OSD',
    meaning: 'There are more placement groups per OSD than mon_max_pg_per_osd.',
    impact: 'OSDs use more memory; new pools or pg_num increases may be refused.',
    todo: ['Add OSDs, lower pg_num of pools that do not need it, or remove unused pools.'],
    link: POOLS,
  },
  POOL_PG_NUM_NOT_POWER_OF_TWO: {
    title: 'Placement group count is not a power of two',
    meaning: 'A pool’s pg_num is not a power of two.',
    impact: 'Placement groups have uneven sizes, so OSDs fill unevenly.',
    todo: ['Set pg_num to a power of two, or let the autoscaler do it.'],
    link: POOLS,
  },
  POOL_TARGET_SIZE_BYTES_OVERCOMMITTED: {
    title: 'Pool size targets exceed the capacity',
    meaning: 'The target_size_bytes of the pools add up to more than the cluster holds.',
    impact: 'The autoscaler plans for data that cannot fit.',
    todo: ['Lower the targets, or add capacity.'],
    link: POOLS,
  },
  POOL_HAS_TARGET_SIZE_BYTES_AND_RATIO: {
    title: 'A pool has two size targets',
    meaning: 'Both target_size_bytes and target_size_ratio are set on a pool.',
    impact: 'The ratio wins; the bytes value is ignored.',
    todo: ['Remove one of them.'],
    link: POOLS,
  },
  TOO_FEW_OSDS: {
    title: 'Fewer OSDs than copies',
    meaning: 'There are fewer OSDs than osd_pool_default_size.',
    impact: 'Pools with the default size cannot place all their copies.',
    todo: ['Add OSDs (Hosts & OSDs, Add storage).'],
    link: OSDS,
  },
  SMALLER_PGP_NUM: {
    title: 'pgp_num is smaller than pg_num',
    meaning: 'A pool has more placement groups than placement targets.',
    impact: 'New placement groups sit on the same OSDs as their parents.',
    todo: ['Set pgp_num equal to pg_num (the autoscaler does it gradually).'],
    link: POOLS,
  },
  MANY_OBJECTS_PER_PG: {
    title: 'A pool has many objects per placement group',
    meaning: 'A pool has far more objects per placement group than the cluster average.',
    impact: 'Slow recovery and scrubs of those placement groups.',
    todo: ['Raise the pool’s pg_num, or let the autoscaler do it.'],
    link: POOLS,
  },
  CACHE_POOL_NEAR_FULL: {
    title: 'A cache tier is nearly full',
    meaning: 'A cache pool is near its target size.',
    impact: 'Client I/O may block while the cache flushes.',
    todo: ['Tune target_max_bytes and the flush ratios, or retire cache tiering (deprecated).'],
    link: POOLS,
  },

  /* -------------------------------------------------------------- crashes */
  RECENT_CRASH: {
    title: 'A daemon crashed recently',
    meaning: 'One or more daemons crashed in the last two weeks and the report is not archived.',
    impact: 'Kubernetes restarted the daemon; repeated crashes point at a bug, a bad disk or memory.',
    todo: ['Read the crash report (Crash reports, below), then archive it so the check clears.'],
  },

  /* ----------------------------------------------------------- auth/cephx */
  AUTH_BAD_CAPS: {
    title: 'A user has invalid capabilities',
    meaning: 'Some auth entities have capabilities the monitors cannot parse.',
    impact: 'Those users may lose access.',
    todo: ['Fix the caps of the named entities ("ceph auth caps").'],
    link: SEC,
  },
  AUTH_INSECURE_GLOBAL_ID_RECLAIM: {
    title: 'Clients reconnect insecurely (global_id)',
    meaning: 'Connected clients reclaim their global_id the insecure way (CVE-2021-20288).',
    impact: 'Security: a client could impersonate another.',
    todo: ['Update the named clients, then set auth_allow_insecure_global_id_reclaim to false.'],
    link: SEC,
  },
  AUTH_INSECURE_GLOBAL_ID_RECLAIM_ALLOWED: {
    title: 'Insecure global_id reclaim is allowed',
    meaning: 'auth_allow_insecure_global_id_reclaim is true (CVE-2021-20288).',
    impact: 'Security: unpatched clients could impersonate others.',
    todo: ['When every client is patched: "ceph config set mon auth_allow_insecure_global_id_reclaim false".'],
    link: SEC,
  },
  AUTH_INSECURE_KEYS_ALLOWED: {
    title: 'Monitors accept the legacy aes cipher',
    meaning:
      'auth_allowed_ciphers contains aes, the old cephx cipher (AES-128-CBC without integrity check, CVE-2025-30156). Someone with a low-privilege key, or who can watch cephx traffic, can forge service tickets.',
    impact: 'Security, not data: an attacker could gain admin access to OSDs, MDS or managers.',
    todo: [
      'Rotate the daemon keys to aes256k through Rook (spec.security.cephx.daemon with a higher keyGeneration).',
      'Then the CSI keys and the CephClient keys.',
      'Only when every key is aes256k, set spec.security.cephx.allowedCiphers: [aes256k]. Do not change auth_allowed_ciphers by hand: Rook resets it.',
      'Rook documents muting it while constraints prevent the fix (spec.healthCheck.muteHealthWarning), and unmuting after the migration.',
    ],
    link: SEC,
  },
  AUTH_INSECURE_KEYS_CREATABLE: {
    title: 'New keys can still use the legacy aes cipher',
    meaning: 'mon_auth_allow_insecure_key is true: new cephx keys can be created with the old aes type (CVE-2025-30156).',
    impact: 'Security: new keys could be weak.',
    todo: [
      'It clears when aes is removed from spec.security.cephx.allowedCiphers.',
      '"ceph config set mon mon_auth_allow_insecure_key false" also clears it, but only if no key will be created or rotated as aes again (it would block Rook keys set to keyType aes).',
    ],
    link: SEC,
  },
  AUTH_INSECURE_SERVICE_KEY_TYPE: {
    title: 'Daemon keys use the legacy aes cipher',
    meaning: 'Monitor, manager, OSD or MDS keys are still of type aes, so service tickets are issued with it (CVE-2025-30156).',
    impact: 'Security: service tickets can be forged; an attacker could reach admin on OSDs, MDS or managers.',
    todo: ['Rotate the daemon keys through Rook: spec.security.cephx.daemon.keyRotationPolicy KeyGeneration with a higher keyGeneration.'],
    link: SEC,
    noMute: 'Rook advises against muting this error: it means tickets can be forged now.',
  },
  AUTH_INSECURE_CLIENT_KEY_TYPE: {
    title: 'Client keys use the legacy aes cipher',
    meaning: 'Some client keys (CSI, CephClients, admin) are of type aes.',
    impact: 'Security: those clients authenticate with the weak cipher.',
    todo: [
      'Rotate the CSI keys (needs Ceph-CSI 3.17.1+ and node kernels 7.0+), then the CephClient keys.',
      'Clients that cannot do aes256k must keep aes until they are upgraded.',
    ],
    link: SEC,
  },
  AUTH_INSECURE_ROTATING_SERVICE_KEY_TYPE: {
    title: 'Rotating service keys still use aes',
    meaning: 'The rotating service keys were generated with the legacy aes cipher.',
    impact: 'Security, temporary after a daemon key rotation.',
    todo: ['It clears on its own 2 to 3 hours after the daemon keys were rotated to aes256k.'],
    link: SEC,
  },
  AUTH_INSECURE_SERVICE_TICKETS: {
    title: 'Service tickets use the legacy aes cipher',
    meaning: 'Monitors still issue service tickets with aes (auth_service_cipher).',
    impact: 'Security: tickets can be tampered with.',
    todo: ['Finish the daemon key rotation through Rook; Rook then switches the service cipher to aes256k.'],
    link: SEC,
    noMute: 'Rook advises against muting this error.',
  },

  /* ------------------------------------------------------------- CephFS */
  FS_DEGRADED: {
    title: 'A file system is degraded',
    meaning: 'One or more MDS ranks of a file system are failed or replaying.',
    impact: 'Clients of that file system see stalls until a standby takes over.',
    todo: ['Check the MDS pods of the file system (File).'],
    link: FS,
    docs: FS_DOCS,
  },
  FS_WITH_FAILED_MDS: {
    title: 'A file system has a failed MDS',
    meaning: 'A file system rank has failed and no standby took it.',
    impact: 'That part of the file system is unavailable.',
    todo: ['Check the MDS pods; add standbys (activeStandby: true in the CephFilesystem).'],
    link: FS,
    docs: FS_DOCS,
  },
  MDS_ALL_DOWN: {
    title: 'Every MDS of a file system is down',
    meaning: 'No metadata server is active for a file system.',
    impact: 'The file system is unavailable.',
    todo: ['Check the MDS pods and their nodes (File).'],
    link: FS,
    docs: FS_DOCS,
  },
  MDS_INSUFFICIENT_STANDBY: {
    title: 'Not enough standby MDS',
    meaning: 'Fewer standby MDS daemons than standby_count_wanted.',
    impact: 'An MDS failure would not be covered at once.',
    todo: ['Run more MDS daemons (activeStandby, or a higher activeCount than needed).'],
    link: FS,
    docs: FS_DOCS,
  },
  MDS_UP_LESS_THAN_MAX: {
    title: 'Fewer active MDS than configured',
    meaning: 'A file system has fewer active ranks than max_mds.',
    impact: 'Metadata load lands on fewer servers.',
    todo: ['Check that enough MDS pods run (File).'],
    link: FS,
    docs: FS_DOCS,
  },
  MDS_DAMAGE: {
    title: 'File system metadata is damaged',
    meaning: 'An MDS found damaged metadata.',
    impact: 'Some files or directories may be unreadable.',
    todo: ['List it with "ceph tell mds.<id> damage ls" and follow the CephFS disaster-recovery docs.'],
    link: FS,
    docs: FS_DOCS,
  },
  MDS_SLOW_REQUEST: {
    title: 'File system requests are slow',
    meaning: 'MDS requests take longer than mds_op_complaint_time (30 s).',
    impact: 'File operations stall for clients.',
    todo: ['Check the MDS load and memory, and slow OSDs under the metadata pool.'],
    link: FS,
    docs: FS_DOCS,
  },
  MDS_SLOW_METADATA_IO: {
    title: 'MDS metadata I/O is slow',
    meaning: 'The MDS waits long for the metadata pool.',
    impact: 'File operations stall.',
    todo: ['Check the OSDs of the metadata pool (latency, SLOW_OPS).'],
    link: FS,
    docs: FS_DOCS,
  },
  MDS_CLIENT_LATE_RELEASE: {
    title: 'A client does not release capabilities',
    meaning: 'A CephFS client holds capabilities the MDS asked it to release.',
    impact: 'Other clients may wait for those files.',
    todo: ['Find the client in the detail; evict it if it is stuck.'],
    link: FS,
    docs: FS_DOCS,
  },
  MDS_CLIENT_RECALL: {
    title: 'A client does not trim its cache',
    meaning: 'A CephFS client is slow to release cached inodes when asked.',
    impact: 'The MDS cache grows.',
    todo: ['Update the client; evict it if it is stuck.'],
    link: FS,
    docs: FS_DOCS,
  },
  MDS_CACHE_OVERSIZED: {
    title: 'MDS cache is too large',
    meaning: 'The MDS cache is above mds_cache_memory_limit.',
    impact: 'The MDS may run out of memory.',
    todo: ['Raise the memory limit (and the pod limit), or find clients that hold too many capabilities.'],
    link: FS,
    docs: FS_DOCS,
  },
  MDS_TRIM: {
    title: 'MDS journal is behind',
    meaning: 'The MDS journal is longer than it should be.',
    impact: 'Slower failover; possible stalls.',
    todo: ['Check the metadata pool latency and MDS load.'],
    link: FS,
    docs: FS_DOCS,
  },
};

/** The Ceph docs page for a health check. */
export function docsUrl(code: string): string {
  const info = lookup(code);
  if (info?.docs) return info.docs;
  const anchor = info?.anchor ?? code.toLowerCase().replace(/_/g, '-');
  return `${HC}#${anchor}`;
}

function lookup(code: string): CheckInfo | undefined {
  const hit = HEALTH_CATALOG[code];
  if (hit) return hit;
  // OSD_HOST_DOWN, OSD_RACK_DOWN, OSD_ROOT_DOWN…: one family.
  if (/^OSD_[A-Z]+_DOWN$/.test(code) && code !== 'OSD_DOWN') {
    const base = HEALTH_CATALOG.OSD_HOST_DOWN;
    const type = code.slice(4, -5).toLowerCase();
    return {
      ...base,
      title: `Every OSD of a ${type} is down`,
      meaning: `All OSDs under a CRUSH ${type} bucket are down.`,
    };
  }
  return undefined;
}

/** What Cairn knows about a code; unknown codes get a generic entry. */
export function checkInfo(code: string, check?: Pick<HealthCheck, 'summary'>): CheckInfo & { known: boolean; docs: string } {
  const hit = lookup(code);
  if (hit) return { ...hit, known: true, docs: docsUrl(code) };
  const area = code.split('_')[0];
  const link =
    area === 'OSD' || area === 'PG' || area === 'BLUESTORE' || area === 'BLUEFS' || area === 'DEVICE'
      ? OSDS
      : area === 'MON'
      ? MONS
      : area === 'MGR'
      ? MGR
      : area === 'POOL'
      ? POOLS
      : area === 'MDS' || area === 'FS'
      ? FS
      : area === 'AUTH'
      ? SEC
      : undefined;
  return {
    title: check?.summary ?? code,
    meaning: check?.summary ?? 'Ceph raised this check.',
    impact: 'Cairn has no notes for this check; the Ceph documentation explains it.',
    todo: ['Read the detail lines and the Ceph documentation for this code.'],
    link,
    known: false,
    docs: area === 'MDS' || area === 'FS' ? FS_DOCS : docsUrl(code),
  };
}

/* --------------------------------------------------------------- verdict */

export interface Verdict {
  tone: StateTone;
  /** One sentence about data safety. */
  title: string;
  /** What is going on, in one or two sentences. */
  detail: string;
}

const FULL_CHECKS = ['OSD_FULL', 'POOL_FULL'];

/**
 * The overview's verdict, about data first: unavailable, lost, damaged,
 * not fully replicated, moving, then Ceph's other warnings.
 */
export function verdict(
  status: ClusterStatus | null,
  health: Health | null,
  counts?: PgCounts | null,
  /** Inactive PGs that belong to pools created minutes ago (no data yet). */
  newInactive = 0
): Verdict {
  if (!status) return { tone: 'idle', title: 'Reading the cluster…', detail: '' };
  const c = counts ?? countsFromStates(status.pg.byState);
  const total = Object.values(c).reduce((a, b) => a + b, 0) || status.pg.total;
  const r = status.recovery;
  const h = health ?? status.health;
  const live = h.checks.filter(x => !x.muted);
  const muted = h.checks.length - live.length;
  const errs = live.filter(x => x.severity === 'HEALTH_ERR').length;
  const warns = live.length - errs;
  const recovering = r.bytesPerSec > 0 || r.objectsPerSec > 0;
  const mutedNote = muted ? ` ${plural(muted, 'muted check')} not counted.` : '';

  if (c.inactive > 0 && newInactive >= c.inactive) {
    return {
      tone: 'move',
      title: 'All data is safe; new placement groups are being created',
      detail: `${plural(c.inactive, 'placement group')} of newly created pools ${c.inactive === 1 ? 'is' : 'are'} not active yet; they hold no data.${
        live.length ? ` ${attention(errs, warns)}.` : ''
      }`,
    };
  }
  if (c.inactive > 0) {
    return {
      tone: 'err',
      title: 'Some data is unavailable',
      detail: `${c.inactive} of ${total} placement groups are inactive: reads and writes to the objects in them wait until they are active again.`,
    };
  }
  if (r.unfoundObjects > 0) {
    return {
      tone: 'err',
      title: 'Some objects cannot be found',
      detail: `${plural(r.unfoundObjects, 'object')} have no copy Ceph can reach; reads of them wait. Bring back the OSDs that were down.`,
    };
  }
  if (c.damaged > 0) {
    return {
      tone: 'err',
      title: 'Some copies disagree',
      detail: `${plural(c.damaged, 'placement group')} ${c.damaged === 1 ? 'is' : 'are'} inconsistent: a scrub found copies that differ. The good copies are readable; repair after finding the cause.`,
    };
  }
  if (c.degraded > 0 || r.degradedObjects > 0) {
    const share = r.degradedRatio > 0 ? `${pct(r.degradedRatio)} of object copies are missing` : 'Some object copies are missing';
    return {
      tone: 'warn',
      title: recovering ? 'Some data is not fully replicated: recovering…' : 'Some data is not fully replicated',
      detail: `${share} (${plural(c.degraded, 'placement group')} degraded). ${
        recovering ? 'Ceph is rebuilding them now.' : 'Ceph is not recovering right now: look for down OSDs, full OSDs or recovery flags.'
      }`,
    };
  }
  const full = live.filter(x => FULL_CHECKS.includes(x.code));
  if (full.length) {
    return {
      tone: 'err',
      title: 'Data is safe, but writes are blocked',
      detail: `${full.map(x => x.summary).join('. ')}. Add capacity or delete data.`,
    };
  }
  if (c.moving > 0 || r.misplacedObjects > 0) {
    const share = r.misplacedRatio > 0 ? ` ${pct(r.misplacedRatio)} of object copies are misplaced.` : '';
    return {
      tone: 'move',
      title: 'All data is safe; Ceph is moving copies',
      detail: `${plural(c.moving, 'placement group')} ${c.moving === 1 ? 'is' : 'are'} rebalancing or peering.${share} Every object keeps its copies.${
        live.length ? ` ${attention(errs, warns)}.` : ''
      }`,
    };
  }
  if (live.length) {
    return {
      tone: errs ? 'err' : 'warn',
      title: `Data is safe. ${attention(errs, warns)}`,
      detail: `Every placement group is active and clean.${mutedNote}`,
    };
  }
  const scrub = c.scrubbing ? ` ${plural(c.scrubbing, 'placement group')} ${c.scrubbing === 1 ? 'is' : 'are'} being scrubbed.` : '';
  return {
    tone: 'ok',
    title: 'All data is safe and fully replicated',
    detail: `Every placement group is active and clean.${scrub}${mutedNote}`,
  };
}

function attention(errs: number, warns: number): string {
  const parts = [errs ? plural(errs, 'error') : '', warns ? plural(warns, 'warning') : ''].filter(Boolean);
  return `${parts.join(' and ')} ${errs + warns === 1 ? 'needs' : 'need'} attention`;
}

/* ----------------------------------------------------------------- mutes */

export const MUTE_TTLS: { label: string; ttl: string }[] = [
  { label: '1 hour', ttl: '1h' },
  { label: '1 day', ttl: '1d' },
  { label: '1 week', ttl: '1w' },
  { label: 'Until it clears', ttl: '' },
];

/** "health mute" (mon). Without a TTL the mute lasts until the check clears (or, sticky, until unmuted). */
export function muteCommand(code: string, ttl: string, sticky: boolean): Record<string, unknown> {
  const cmd: Record<string, unknown> = { prefix: 'health mute', code };
  if (ttl) cmd.ttl = ttl;
  if (sticky) cmd.sticky = true;
  return cmd;
}

export function unmuteCommand(code: string): Record<string, unknown> {
  return { prefix: 'health unmute', code };
}

/** "ceph health mute X 1h --sticky", for the record. */
export function cliText(cmd: Record<string, unknown>): string {
  const { prefix, ...rest } = cmd;
  const parts = [`ceph ${prefix}`];
  for (const [k, v] of Object.entries(rest)) {
    if (v === true) parts.push(`--${k}`);
    else if (Array.isArray(v)) parts.push(v.join(' '));
    else if (v !== undefined && v !== '') parts.push(String(v));
  }
  return parts.join(' ');
}
