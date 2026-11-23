/* Answers captured on a test cluster (Ceph 20.2.4, Rook 1.21.2, 3 OSDs), host names, addresses and disk serials replaced, for tests. */
/* eslint-disable */
export const SAMPLE: Record<string, any> = {
 "status": {
  "fsid": "00000000-0000-4000-8000-000000000001",
  "health": {
   "status": "HEALTH_WARN",
   "checks": {
    "AUTH_INSECURE_KEYS_ALLOWED": {
     "severity": "HEALTH_WARN",
     "summary": {
      "message": "Monitors are configured to allow auth using insecure key types",
      "count": 1
     },
     "muted": false
    },
    "AUTH_INSECURE_KEYS_CREATABLE": {
     "severity": "HEALTH_WARN",
     "summary": {
      "message": "Monitors are configured to allow creation of insecure key types",
      "count": 1
     },
     "muted": false
    }
   },
   "mutes": []
  },
  "election_epoch": 14,
  "quorum": [
   0,
   1,
   2
  ],
  "quorum_names": [
   "a",
   "b",
   "c"
  ],
  "quorum_age": 5250,
  "monmap": {
   "epoch": 4,
   "min_mon_release_name": "tentacle",
   "num_mons": 3
  },
  "osdmap": {
   "epoch": 153,
   "num_osds": 3,
   "num_up_osds": 3,
   "osd_up_since": 1795396590,
   "num_in_osds": 3,
   "osd_in_since": 1795396573,
   "num_remapped_pgs": 0
  },
  "pgmap": {
   "pgs_by_state": [
    {
     "state_name": "active+clean",
     "count": 33
    }
   ],
   "num_pgs": 33,
   "num_pools": 2,
   "num_objects": 2576,
   "data_bytes": 9522094701,
   "bytes_used": 27134017536,
   "bytes_avail": 230564020224,
   "bytes_total": 257698037760,
   "read_bytes_sec": 6484,
   "write_bytes_sec": 8190,
   "read_op_per_sec": 7,
   "write_op_per_sec": 0
  },
  "fsmap": {
   "epoch": 1,
   "btime": "2026-11-22T23:42:05:508841+0000",
   "by_rank": [],
   "up:standby": 0
  },
  "mgrmap": {
   "available": true,
   "num_standbys": 0,
   "modules": [
    "dashboard",
    "iostat",
    "nfs",
    "nvmeof",
    "prometheus"
   ],
   "services": {
    "dashboard": "http://192.0.2.101:7000/",
    "prometheus": "http://192.0.2.101:9283/"
   }
  },
  "servicemap": {
   "epoch": 32,
   "modified": "2026-11-23T02:17:32.352837+0000",
   "services": {}
  },
  "progress_events": {}
 },
 "osdDfTree": {
  "nodes": [
   {
    "id": -1,
    "name": "default",
    "type": "root",
    "type_id": 11,
    "reweight": -1,
    "kb": 251658240,
    "kb_used": 26496576,
    "kb_used_data": 24193744,
    "kb_used_omap": 121,
    "kb_used_meta": 2302660,
    "kb_avail": 225161664,
    "utilization": 10.528793334960938,
    "var": 1,
    "pgs": 0,
    "children": [
     -7,
     -3,
     -5
    ]
   },
   {
    "id": -5,
    "name": "kube-node-1-example-com",
    "type": "host",
    "type_id": 1,
    "pool_weights": {},
    "reweight": -1,
    "kb": 83886080,
    "kb_used": 9389400,
    "kb_used_data": 8064584,
    "kb_used_omap": 15,
    "kb_used_meta": 1324784,
    "kb_avail": 74496680,
    "utilization": 11.193037033081055,
    "var": 1.063088302428208,
    "pgs": 0,
    "children": [
     1
    ]
   },
   {
    "id": 1,
    "device_class": "hdd",
    "name": "osd.1",
    "type": "osd",
    "type_id": 0,
    "crush_weight": 0.078094482421875,
    "depth": 2,
    "pool_weights": {},
    "reweight": 1,
    "kb": 83886080,
    "kb_used": 9389400,
    "kb_used_data": 8064584,
    "kb_used_omap": 15,
    "kb_used_meta": 1324784,
    "kb_avail": 74496680,
    "utilization": 11.193037033081055,
    "var": 1.063088302428208,
    "pgs": 33,
    "status": "up"
   },
   {
    "id": -3,
    "name": "kube-node-2-example-com",
    "type": "host",
    "type_id": 1,
    "pool_weights": {},
    "reweight": -1,
    "kb": 83886080,
    "kb_used": 8745040,
    "kb_used_data": 8064576,
    "kb_used_omap": 16,
    "kb_used_meta": 680431,
    "kb_avail": 75141040,
    "utilization": 10.42490005493164,
    "var": 0.9901324608885315,
    "pgs": 0,
    "children": [
     0
    ]
   },
   {
    "id": 0,
    "device_class": "hdd",
    "name": "osd.0",
    "type": "osd",
    "type_id": 0,
    "crush_weight": 0.078094482421875,
    "depth": 2,
    "pool_weights": {},
    "reweight": 1,
    "kb": 83886080,
    "kb_used": 8745040,
    "kb_used_data": 8064576,
    "kb_used_omap": 16,
    "kb_used_meta": 680431,
    "kb_avail": 75141040,
    "utilization": 10.42490005493164,
    "var": 0.9901324608885315,
    "pgs": 33,
    "status": "up"
   },
   {
    "id": -7,
    "name": "kube-node-3-example-com",
    "type": "host",
    "type_id": 1,
    "pool_weights": {},
    "reweight": -1,
    "kb": 83886080,
    "kb_used": 8362136,
    "kb_used_data": 8064584,
    "kb_used_omap": 90,
    "kb_used_meta": 297445,
    "kb_avail": 75523944,
    "utilization": 9.968442916870117,
    "var": 0.9467792366832605,
    "pgs": 0,
    "children": [
     2
    ]
   },
   {
    "id": 2,
    "device_class": "hdd",
    "name": "osd.2",
    "type": "osd",
    "type_id": 0,
    "crush_weight": 0.078094482421875,
    "depth": 2,
    "pool_weights": {},
    "reweight": 1,
    "kb": 83886080,
    "kb_used": 8362136,
    "kb_used_data": 8064584,
    "kb_used_omap": 90,
    "kb_used_meta": 297445,
    "kb_avail": 75523944,
    "utilization": 9.968442916870117,
    "var": 0.9467792366832605,
    "pgs": 33,
    "status": "up"
   }
  ],
  "stray": [],
  "summary": {
   "total_kb": 251658240,
   "total_kb_used": 26496576,
   "total_kb_used_data": 24193744,
   "total_kb_used_omap": 122,
   "total_kb_used_meta": 2302661,
   "total_kb_avail": 225161664,
   "average_utilization": 10.528793334960938,
   "min_var": 0.9467792366832605,
   "max_var": 1.063088302428208,
   "dev": 0.5053071987026283
  }
 },
 "osdDump": {
  "epoch": 153,
  "fsid": "00000000-0000-4000-8000-000000000001",
  "flags": "sortbitwise,recovery_deletes,purged_snapdirs,pglog_hardlimit",
  "full_ratio": 0.949999988079071,
  "backfillfull_ratio": 0.8999999761581421,
  "nearfull_ratio": 0.8500000238418579,
  "require_min_compat_client": "luminous",
  "require_osd_release": "tentacle",
  "erasure_code_profiles": {
   "default": {
    "k": "2",
    "m": "2",
    "plugin": "isa",
    "technique": "reed_sol_van"
   }
  },
  "blocklist": {
   "192.0.2.101:0/1004": "2026-11-23T23:43:01.714141+0000",
   "192.0.2.101:6801/1007": "2026-11-23T23:43:01.714141+0000",
   "192.0.2.101:6800/1007": "2026-11-23T23:43:01.714141+0000",
   "192.0.2.101:0/1006": "2026-11-23T23:42:51.089301+0000",
   "192.0.2.101:0/1013": "2026-11-23T23:43:01.714141+0000",
   "192.0.2.101:0/1002": "2026-11-23T23:43:01.714141+0000",
   "192.0.2.101:0/1001": "2026-11-23T23:42:51.089301+0000",
   "192.0.2.101:6801/1010": "2026-11-23T23:42:51.089301+0000",
   "192.0.2.101:0/1008": "2026-11-23T23:42:51.089301+0000",
   "192.0.2.101:6800/1010": "2026-11-23T23:42:51.089301+0000"
  },
  "osds": [
   {
    "osd": 0,
    "uuid": "00000000-0000-4000-8000-000000000004",
    "up": 1,
    "in": 1,
    "weight": 1,
    "primary_affinity": 1,
    "state": [
     "exists",
     "up"
    ],
    "public_addr": "192.0.2.116:6801/1012"
   },
   {
    "osd": 1,
    "uuid": "00000000-0000-4000-8000-000000000007",
    "up": 1,
    "in": 1,
    "weight": 1,
    "primary_affinity": 1,
    "state": [
     "exists",
     "up"
    ],
    "public_addr": "192.0.2.25:6801/1011"
   },
   {
    "osd": 2,
    "uuid": "00000000-0000-4000-8000-000000000008",
    "up": 1,
    "in": 1,
    "weight": 1,
    "primary_affinity": 1,
    "state": [
     "exists",
     "up"
    ],
    "public_addr": "198.51.100.196:6801/1005"
   }
  ],
  "pools": [
   {
    "pool": 1,
    "pool_name": "vm-pool",
    "create_time": "2026-11-22T23:45:01.810205+0000",
    "flags": 8193,
    "flags_names": "hashpspool,selfmanaged_snaps",
    "type": 1,
    "size": 3,
    "min_size": 2,
    "crush_rule": 1,
    "peering_crush_bucket_count": 0,
    "peering_crush_bucket_target": 0,
    "peering_crush_bucket_barrier": 0,
    "peering_crush_bucket_mandatory_member": 2147483647,
    "is_stretch_pool": false,
    "object_hash": 2,
    "pg_autoscale_mode": "on",
    "pg_num": 32,
    "pg_placement_num": 32,
    "pg_placement_num_target": 32,
    "pg_num_target": 32,
    "pg_num_pending": 32,
    "last_pg_merge_meta": {
     "source_pgid": "0.0",
     "ready_epoch": 0,
     "last_epoch_started": 0,
     "last_epoch_clean": 0,
     "source_version": "0'0",
     "target_version": "0'0"
    },
    "last_change": "152",
    "last_force_op_resend": "0",
    "last_force_op_resend_prenautilus": "0",
    "last_force_op_resend_preluminous": "20",
    "auid": 0,
    "snap_mode": "selfmanaged",
    "snap_seq": 2,
    "snap_epoch": 20,
    "pool_snaps": [],
    "removed_snaps": "[]",
    "quota_max_bytes": 0,
    "quota_max_objects": 0,
    "tiers": [],
    "tier_of": -1,
    "read_tier": -1,
    "write_tier": -1,
    "cache_mode": "none",
    "target_max_bytes": 0,
    "target_max_objects": 0,
    "cache_target_dirty_ratio_micro": 400000,
    "cache_target_dirty_high_ratio_micro": 600000,
    "cache_target_full_ratio_micro": 800000,
    "cache_min_flush_age": 0,
    "cache_min_evict_age": 0,
    "erasure_code_profile": "",
    "hit_set_params": {
     "type": "none"
    },
    "hit_set_period": 0,
    "hit_set_count": 0,
    "use_gmt_hitset": true,
    "min_read_recency_for_promote": 0,
    "min_write_recency_for_promote": 0,
    "hit_set_grade_decay_rate": 0,
    "hit_set_search_last_n": 0,
    "grade_table": [],
    "stripe_width": 0,
    "expected_num_objects": 0,
    "fast_read": false,
    "nonprimary_shards": "{}",
    "options": {
     "compression_mode": "none"
    },
    "application_metadata": {
     "rbd": {}
    },
    "read_balance": {
     "score_type": "Fair distribution",
     "score_acting": 1.2200000286102295,
     "score_stable": 1.2200000286102295,
     "optimal_score": 1,
     "raw_score_acting": 1.2200000286102295,
     "raw_score_stable": 1.2200000286102295,
     "primary_affinity_weighted": 1,
     "average_primary_affinity": 1,
     "average_primary_affinity_weighted": 1
    }
   },
   {
    "pool": 2,
    "pool_name": ".mgr",
    "create_time": "2026-11-23T01:16:31.734666+0000",
    "flags": 1,
    "flags_names": "hashpspool",
    "type": 1,
    "size": 3,
    "min_size": 2,
    "crush_rule": 0,
    "peering_crush_bucket_count": 0,
    "peering_crush_bucket_target": 0,
    "peering_crush_bucket_barrier": 0,
    "peering_crush_bucket_mandatory_member": 2147483647,
    "is_stretch_pool": false,
    "object_hash": 2,
    "pg_autoscale_mode": "on",
    "pg_num": 1,
    "pg_placement_num": 1,
    "pg_placement_num_target": 1,
    "pg_num_target": 1,
    "pg_num_pending": 1,
    "last_pg_merge_meta": {
     "source_pgid": "0.0",
     "ready_epoch": 0,
     "last_epoch_started": 0,
     "last_epoch_clean": 0,
     "source_version": "0'0",
     "target_version": "0'0"
    },
    "last_change": "35",
    "last_force_op_resend": "0",
    "last_force_op_resend_prenautilus": "0",
    "last_force_op_resend_preluminous": "0",
    "auid": 0,
    "snap_mode": "selfmanaged",
    "snap_seq": 0,
    "snap_epoch": 0,
    "pool_snaps": [],
    "removed_snaps": "[]",
    "quota_max_bytes": 0,
    "quota_max_objects": 0,
    "tiers": [],
    "tier_of": -1,
    "read_tier": -1,
    "write_tier": -1,
    "cache_mode": "none",
    "target_max_bytes": 0,
    "target_max_objects": 0,
    "cache_target_dirty_ratio_micro": 400000,
    "cache_target_dirty_high_ratio_micro": 600000,
    "cache_target_full_ratio_micro": 800000,
    "cache_min_flush_age": 0,
    "cache_min_evict_age": 0,
    "erasure_code_profile": "",
    "hit_set_params": {
     "type": "none"
    },
    "hit_set_period": 0,
    "hit_set_count": 0,
    "use_gmt_hitset": true,
    "min_read_recency_for_promote": 0,
    "min_write_recency_for_promote": 0,
    "hit_set_grade_decay_rate": 0,
    "hit_set_search_last_n": 0,
    "grade_table": [],
    "stripe_width": 0,
    "expected_num_objects": 0,
    "fast_read": false,
    "nonprimary_shards": "{}",
    "options": {
     "pg_num_max": 32,
     "pg_num_min": 1
    },
    "application_metadata": {
     "mgr": {}
    },
    "read_balance": {
     "score_type": "Fair distribution",
     "score_acting": 3,
     "score_stable": 3,
     "optimal_score": 1,
     "raw_score_acting": 3,
     "raw_score_stable": 3,
     "primary_affinity_weighted": 1,
     "average_primary_affinity": 1,
     "average_primary_affinity_weighted": 1
    }
   }
  ]
 },
 "df": {
  "stats": {
   "total_bytes": 257698037760,
   "total_avail_bytes": 230564020224,
   "total_used_bytes": 27134017536,
   "total_used_raw_bytes": 27134017536,
   "total_used_raw_ratio": 0.10529384762048721,
   "num_osds": 3,
   "num_per_pool_osds": 3,
   "num_per_pool_omap_osds": 3
  },
  "stats_by_class": {
   "hdd": {
    "total_bytes": 257698037760,
    "total_avail_bytes": 230564020224,
    "total_used_bytes": 27134017536,
    "total_used_raw_bytes": 27134017536,
    "total_used_raw_ratio": 0.10529384762048721
   }
  },
  "pools": [
   {
    "name": "vm-pool",
    "id": 1,
    "stats": {
     "stored": 8256079666,
     "stored_data": 8256057344,
     "stored_omap": 22322,
     "objects": 2574,
     "kb_used": 24187854,
     "bytes_used": 24768361878,
     "data_bytes_used": 24768294912,
     "omap_bytes_used": 66966,
     "percent_used": 0.10288654267787933,
     "max_avail": 71988781056,
     "quota_objects": 0,
     "quota_bytes": 0,
     "dirty": 0,
     "rd": 44115,
     "rd_bytes": 1725374464,
     "wr": 9770,
     "wr_bytes": 255592448,
     "compress_bytes_used": 0,
     "compress_under_bytes": 0,
     "stored_raw": 24768239616,
     "avail_raw": 215966358235
    }
   },
   {
    "name": ".mgr",
    "id": 2,
    "stats": {
     "stored": 590368,
     "stored_data": 590368,
     "stored_omap": 0,
     "objects": 2,
     "kb_used": 1740,
     "bytes_used": 1781760,
     "data_bytes_used": 1781760,
     "omap_bytes_used": 0,
     "percent_used": 8.250105565821286e-06,
     "max_avail": 71988781056,
     "quota_objects": 0,
     "quota_bytes": 0,
     "dirty": 0,
     "rd": 106,
     "rd_bytes": 93184,
     "wr": 189,
     "wr_bytes": 3805184,
     "compress_bytes_used": 0,
     "compress_under_bytes": 0,
     "stored_raw": 1771104,
     "avail_raw": 215966358235
    }
   }
  ]
 },
 "osdMetadata": [
  {
   "id": 0,
   "hostname": "kube-node-2.example.com",
   "devices": "sdb",
   "device_paths": "sdb=/dev/disk/by-path/pci-0000:09:02.0-scsi-0:0:0:1",
   "device_ids": "sdb=QEMU_QEMU_HARDDISK_DISK-OSD2",
   "rotational": "1",
   "bluestore_bdev_type": "hdd",
   "bluestore_bdev_size": "85899345920",
   "osd_objectstore": "bluestore",
   "ceph_version_short": "20.2.4",
   "kernel_version": "7.3.4-300.fc45.x86_64",
   "distro_description": "CentOS Stream 9",
   "pod_name": "rook-ceph-osd-0-7c9d8b6f5-aaaaa",
   "pod_namespace": "rook-ceph",
   "bluefs_dedicated_db": "0",
   "bluefs_dedicated_wal": "0",
   "mem_total_kb": "16358652"
  },
  {
   "id": 1,
   "hostname": "kube-node-1.example.com",
   "devices": "sdb",
   "device_paths": "sdb=/dev/disk/by-path/pci-0000:09:02.0-scsi-0:0:0:1",
   "device_ids": "sdb=QEMU_QEMU_HARDDISK_DISK-OSD1",
   "rotational": "1",
   "bluestore_bdev_type": "hdd",
   "bluestore_bdev_size": "85899345920",
   "osd_objectstore": "bluestore",
   "ceph_version_short": "20.2.4",
   "kernel_version": "7.3.4-300.fc45.x86_64",
   "distro_description": "CentOS Stream 9",
   "pod_name": "rook-ceph-osd-1-7c9d8b6f5-bbbbb",
   "pod_namespace": "rook-ceph",
   "bluefs_dedicated_db": "0",
   "bluefs_dedicated_wal": "0",
   "mem_total_kb": "20462836"
  },
  {
   "id": 2,
   "hostname": "kube-node-3.example.com",
   "devices": "sdb",
   "device_paths": "sdb=/dev/disk/by-path/pci-0000:09:02.0-scsi-0:0:0:1",
   "device_ids": "sdb=QEMU_QEMU_HARDDISK_DISK-OSD3",
   "rotational": "1",
   "bluestore_bdev_type": "hdd",
   "bluestore_bdev_size": "85899345920",
   "osd_objectstore": "bluestore",
   "ceph_version_short": "20.2.4",
   "kernel_version": "7.3.4-300.fc45.x86_64",
   "distro_description": "CentOS Stream 9",
   "pod_name": "rook-ceph-osd-2-7c9d8b6f5-ccccc",
   "pod_namespace": "rook-ceph",
   "bluefs_dedicated_db": "0",
   "bluefs_dedicated_wal": "0",
   "mem_total_kb": "12230584"
  }
 ],
 "quorum": {
  "election_epoch": 14,
  "quorum": [
   0,
   1,
   2
  ],
  "quorum_names": [
   "a",
   "b",
   "c"
  ],
  "quorum_leader_name": "a",
  "quorum_age": 5250,
  "features": {
   "quorum_con": "4541880224203014143",
   "quorum_mon": [
    "kraken",
    "luminous",
    "mimic",
    "osdmap-prune",
    "nautilus",
    "octopus",
    "pacific",
    "elector-pinging",
    "quincy",
    "reef",
    "squid",
    "tentacle",
    "cephx_auth_aes256k",
    "nvmeof_beacon_diff"
   ]
  },
  "monmap": {
   "epoch": 4,
   "auth_epoch": 0,
   "auth_service_cipher": {
    "name": "aes256k",
    "value": 2
   },
   "auth_allowed_ciphers": [
    {
     "name": "aes",
     "value": 1
    },
    {
     "name": "aes256k",
     "value": 2
    }
   ],
   "auth_preferred_cipher": {
    "name": "aes256k",
    "value": 2
   },
   "fsid": "00000000-0000-4000-8000-000000000001",
   "modified": "2026-11-23T01:15:41.653206Z",
   "created": "2026-11-22T23:42:04.580750Z",
   "min_mon_release": 20,
   "min_mon_release_name": "tentacle",
   "election_strategy": 1,
   "disallowed_leaders": "",
   "stretch_mode": false,
   "tiebreaker_mon": "",
   "removed_ranks": "",
   "features": {
    "persistent": [
     "kraken",
     "luminous",
     "mimic",
     "osdmap-prune",
     "nautilus",
     "octopus",
     "pacific",
     "elector-pinging",
     "quincy",
     "reef",
     "squid",
     "tentacle",
     "cephx_auth_aes256k",
     "nvmeof_beacon_diff"
    ],
    "optional": []
   },
   "mons": [
    {
     "rank": 0,
     "name": "a",
     "public_addrs": {
      "addrvec": [
       {
        "type": "v2",
        "addr": "203.0.113.11:3300",
        "nonce": 0
       },
       {
        "type": "v1",
        "addr": "203.0.113.11:6789",
        "nonce": 0
       }
      ]
     },
     "addr": "203.0.113.11:6789/0",
     "public_addr": "203.0.113.11:6789/0",
     "priority": 0,
     "weight": 0,
     "time_added": "2026-11-22T23:42:04:580747+0000",
     "crush_location": []
    },
    {
     "rank": 1,
     "name": "b",
     "public_addrs": {
      "addrvec": [
       {
        "type": "v2",
        "addr": "203.0.113.12:3300",
        "nonce": 0
       },
       {
        "type": "v1",
        "addr": "203.0.113.12:6789",
        "nonce": 0
       }
      ]
     },
     "addr": "203.0.113.12:6789/0",
     "public_addr": "203.0.113.12:6789/0",
     "priority": 0,
     "weight": 0,
     "time_added": "2026-11-23T01:15:09:658659+0000",
     "crush_location": []
    },
    {
     "rank": 2,
     "name": "c",
     "public_addrs": {
      "addrvec": [
       {
        "type": "v2",
        "addr": "203.0.113.13:3300",
        "nonce": 0
       },
       {
        "type": "v1",
        "addr": "203.0.113.13:6789",
        "nonce": 0
       }
      ]
     },
     "addr": "203.0.113.13:6789/0",
     "public_addr": "203.0.113.13:6789/0",
     "priority": 0,
     "weight": 0,
     "time_added": "2026-11-23T01:15:41:653202+0000",
     "crush_location": []
    }
   ]
  }
 },
 "versions": {
  "mon": {
   "ceph version 20.2.4 (7f793731f1b39eb4f465e960113d2363c311b964) tentacle (stable - RelWithDebInfo)": 3
  },
  "mgr": {
   "ceph version 20.2.4 (7f793731f1b39eb4f465e960113d2363c311b964) tentacle (stable - RelWithDebInfo)": 1
  },
  "osd": {
   "ceph version 20.2.4 (7f793731f1b39eb4f465e960113d2363c311b964) tentacle (stable - RelWithDebInfo)": 3
  },
  "overall": {
   "ceph version 20.2.4 (7f793731f1b39eb4f465e960113d2363c311b964) tentacle (stable - RelWithDebInfo)": 7
  }
 },
 "crushRules": [
  {
   "rule_id": 0,
   "rule_name": "replicated_rule",
   "type": 1,
   "steps": [
    {
     "op": "take",
     "item": -1,
     "item_name": "default"
    },
    {
     "op": "chooseleaf_firstn",
     "num": 0,
     "type": "host"
    },
    {
     "op": "emit"
    }
   ]
  },
  {
   "rule_id": 1,
   "rule_name": "vm-pool",
   "type": 1,
   "steps": [
    {
     "op": "take",
     "item": -1,
     "item_name": "default"
    },
    {
     "op": "chooseleaf_firstn",
     "num": 0,
     "type": "host"
    },
    {
     "op": "emit"
    }
   ]
  }
 ],
 "poolLs": [
  {
   "pool_id": 1,
   "pool_name": "vm-pool",
   "create_time": "2026-11-22T23:45:01.810205+0000",
   "flags": 8193,
   "flags_names": "hashpspool,selfmanaged_snaps",
   "type": 1,
   "size": 3,
   "min_size": 2,
   "crush_rule": 1,
   "peering_crush_bucket_count": 0,
   "peering_crush_bucket_target": 0,
   "peering_crush_bucket_barrier": 0,
   "peering_crush_bucket_mandatory_member": 2147483647,
   "is_stretch_pool": false,
   "object_hash": 2,
   "pg_autoscale_mode": "on",
   "pg_num": 32,
   "pg_placement_num": 32,
   "pg_placement_num_target": 32,
   "pg_num_target": 32,
   "pg_num_pending": 32,
   "last_pg_merge_meta": {
    "source_pgid": "0.0",
    "ready_epoch": 0,
    "last_epoch_started": 0,
    "last_epoch_clean": 0,
    "source_version": "0'0",
    "target_version": "0'0"
   },
   "last_change": "152",
   "last_force_op_resend": "0",
   "last_force_op_resend_prenautilus": "0",
   "last_force_op_resend_preluminous": "20",
   "auid": 0,
   "snap_mode": "selfmanaged",
   "snap_seq": 2,
   "snap_epoch": 20,
   "pool_snaps": [],
   "removed_snaps": "[]",
   "quota_max_bytes": 0,
   "quota_max_objects": 0,
   "tiers": [],
   "tier_of": -1,
   "read_tier": -1,
   "write_tier": -1,
   "cache_mode": "none",
   "target_max_bytes": 0,
   "target_max_objects": 0,
   "cache_target_dirty_ratio_micro": 400000,
   "cache_target_dirty_high_ratio_micro": 600000,
   "cache_target_full_ratio_micro": 800000,
   "cache_min_flush_age": 0,
   "cache_min_evict_age": 0,
   "erasure_code_profile": "",
   "hit_set_params": {
    "type": "none"
   },
   "hit_set_period": 0,
   "hit_set_count": 0,
   "use_gmt_hitset": true,
   "min_read_recency_for_promote": 0,
   "min_write_recency_for_promote": 0,
   "hit_set_grade_decay_rate": 0,
   "hit_set_search_last_n": 0,
   "grade_table": [],
   "stripe_width": 0,
   "expected_num_objects": 0,
   "fast_read": false,
   "nonprimary_shards": "{}",
   "options": {
    "compression_mode": "none"
   },
   "application_metadata": {
    "rbd": {}
   },
   "read_balance": {
    "score_type": "Fair distribution",
    "score_acting": 1.2200000286102295,
    "score_stable": 1.2200000286102295,
    "optimal_score": 1,
    "raw_score_acting": 1.2200000286102295,
    "raw_score_stable": 1.2200000286102295,
    "primary_affinity_weighted": 1,
    "average_primary_affinity": 1,
    "average_primary_affinity_weighted": 1
   }
  },
  {
   "pool_id": 2,
   "pool_name": ".mgr",
   "create_time": "2026-11-23T01:16:31.734666+0000",
   "flags": 1,
   "flags_names": "hashpspool",
   "type": 1,
   "size": 3,
   "min_size": 2,
   "crush_rule": 0,
   "peering_crush_bucket_count": 0,
   "peering_crush_bucket_target": 0,
   "peering_crush_bucket_barrier": 0,
   "peering_crush_bucket_mandatory_member": 2147483647,
   "is_stretch_pool": false,
   "object_hash": 2,
   "pg_autoscale_mode": "on",
   "pg_num": 1,
   "pg_placement_num": 1,
   "pg_placement_num_target": 1,
   "pg_num_target": 1,
   "pg_num_pending": 1,
   "last_pg_merge_meta": {
    "source_pgid": "0.0",
    "ready_epoch": 0,
    "last_epoch_started": 0,
    "last_epoch_clean": 0,
    "source_version": "0'0",
    "target_version": "0'0"
   },
   "last_change": "35",
   "last_force_op_resend": "0",
   "last_force_op_resend_prenautilus": "0",
   "last_force_op_resend_preluminous": "0",
   "auid": 0,
   "snap_mode": "selfmanaged",
   "snap_seq": 0,
   "snap_epoch": 0,
   "pool_snaps": [],
   "removed_snaps": "[]",
   "quota_max_bytes": 0,
   "quota_max_objects": 0,
   "tiers": [],
   "tier_of": -1,
   "read_tier": -1,
   "write_tier": -1,
   "cache_mode": "none",
   "target_max_bytes": 0,
   "target_max_objects": 0,
   "cache_target_dirty_ratio_micro": 400000,
   "cache_target_dirty_high_ratio_micro": 600000,
   "cache_target_full_ratio_micro": 800000,
   "cache_min_flush_age": 0,
   "cache_min_evict_age": 0,
   "erasure_code_profile": "",
   "hit_set_params": {
    "type": "none"
   },
   "hit_set_period": 0,
   "hit_set_count": 0,
   "use_gmt_hitset": true,
   "min_read_recency_for_promote": 0,
   "min_write_recency_for_promote": 0,
   "hit_set_grade_decay_rate": 0,
   "hit_set_search_last_n": 0,
   "grade_table": [],
   "stripe_width": 0,
   "expected_num_objects": 0,
   "fast_read": false,
   "nonprimary_shards": "{}",
   "options": {
    "pg_num_max": 32,
    "pg_num_min": 1
   },
   "application_metadata": {
    "mgr": {}
   },
   "read_balance": {
    "score_type": "Fair distribution",
    "score_acting": 3,
    "score_stable": 3,
    "optimal_score": 1,
    "raw_score_acting": 3,
    "raw_score_stable": 3,
    "primary_affinity_weighted": 1,
    "average_primary_affinity": 1,
    "average_primary_affinity_weighted": 1
   }
  }
 ],
 "pgBrief": {
  "pg_ready": true,
  "pg_stats": [
   {
    "pgid": "1.1f",
    "state": "active+clean",
    "up": [
     0,
     2,
     1
    ],
    "acting": [
     0,
     2,
     1
    ],
    "up_primary": 0,
    "acting_primary": 0
   },
   {
    "pgid": "1.1e",
    "state": "active+clean",
    "up": [
     2,
     1,
     0
    ],
    "acting": [
     2,
     1,
     0
    ],
    "up_primary": 2,
    "acting_primary": 2
   },
   {
    "pgid": "1.1d",
    "state": "active+clean",
    "up": [
     0,
     2,
     1
    ],
    "acting": [
     0,
     2,
     1
    ],
    "up_primary": 0,
    "acting_primary": 0
   },
   {
    "pgid": "1.b",
    "state": "active+clean",
    "up": [
     2,
     0,
     1
    ],
    "acting": [
     2,
     0,
     1
    ],
    "up_primary": 2,
    "acting_primary": 2
   }
  ]
 },
 "health": {
  "status": "HEALTH_WARN",
  "checks": {
   "AUTH_INSECURE_KEYS_ALLOWED": {
    "severity": "HEALTH_WARN",
    "summary": {
     "message": "Monitors are configured to allow auth using insecure key types",
     "count": 1
    },
    "detail": [
     {
      "message": "insecure cipher aes allowed for auth"
     }
    ],
    "muted": false
   },
   "AUTH_INSECURE_KEYS_CREATABLE": {
    "severity": "HEALTH_WARN",
    "summary": {
     "message": "Monitors are configured to allow creation of insecure key types",
     "count": 1
    },
    "detail": [],
    "muted": false
   }
  },
  "mutes": []
 },
 "healthHistory": {
  "AUTH_INSECURE_KEYS_ALLOWED": {
   "name": "AUTH_INSECURE_KEYS_ALLOWED",
   "severity": "HEALTH_WARN",
   "first_seen": 1795390971.1181164,
   "last_seen": 1795402037.957771,
   "count": 1,
   "active": true
  },
  "AUTH_INSECURE_KEYS_CREATABLE": {
   "name": "AUTH_INSECURE_KEYS_CREATABLE",
   "severity": "HEALTH_WARN",
   "first_seen": 1795390971.1181164,
   "last_seen": 1795402037.957771,
   "count": 1,
   "active": true
  },
  "TOO_FEW_OSDS": {
   "name": "TOO_FEW_OSDS",
   "severity": "HEALTH_WARN",
   "first_seen": 1795390997.7894251,
   "last_seen": 1795396562.8733056,
   "count": 1,
   "active": false
  },
  "PG_DEGRADED": {
   "name": "PG_DEGRADED",
   "severity": "HEALTH_WARN",
   "first_seen": 1795391117.791045,
   "last_seen": 1795397432.8877563,
   "count": 2,
   "active": false
  }
 },
 "osdPerf": {
  "pg_ready": true,
  "osdstats": {
   "osd_perf_infos": [
    {
     "id": 2,
     "perf_stats": {
      "commit_latency_ms": 8,
      "apply_latency_ms": 8,
      "commit_latency_ns": 8000000,
      "apply_latency_ns": 8000000
     }
    },
    {
     "id": 1,
     "perf_stats": {
      "commit_latency_ms": 2,
      "apply_latency_ms": 2,
      "commit_latency_ns": 2000000,
      "apply_latency_ns": 2000000
     }
    },
    {
     "id": 0,
     "perf_stats": {
      "commit_latency_ms": 2,
      "apply_latency_ms": 2,
      "commit_latency_ns": 2000000,
      "apply_latency_ns": 2000000
     }
    }
   ]
  }
 },
 "poolStats": [
  {
   "pool_name": "vm-pool",
   "pool_id": 1,
   "recovery": {},
   "recovery_rate": {},
   "client_io_rate": {
    "read_bytes_sec": 1365,
    "write_bytes_sec": 26277,
    "read_op_per_sec": 0,
    "write_op_per_sec": 4
   }
  },
  {
   "pool_name": ".mgr",
   "pool_id": 2,
   "recovery": {},
   "recovery_rate": {},
   "client_io_rate": {}
  }
 ],
 "autoscale": [
  {
   "actual_capacity_ratio": 0.0961168026784435,
   "actual_raw_used": 24769111446,
   "bias": 1.0,
   "bulk": false,
   "capacity_ratio": 0.0961168026784435,
   "crush_root_id": -1,
   "effective_target_ratio": 0.0,
   "logical_used": 8256370482.0,
   "pg_autoscale_mode": "on",
   "pg_num_final": 32,
   "pg_num_ideal": 9,
   "pg_num_target": 32,
   "pool_id": 1,
   "pool_name": "vm-pool",
   "raw_used": 24769111446,
   "raw_used_rate": 3.0,
   "subtree_capacity": 257698037760,
   "target_bytes": 0,
   "target_ratio": 0.0,
   "would_adjust": false
  },
  {
   "actual_capacity_ratio": 6.9141387939453125e-06,
   "actual_raw_used": 1781760,
   "bias": 1.0,
   "bulk": false,
   "capacity_ratio": 6.9141387939453125e-06,
   "crush_root_id": -1,
   "effective_target_ratio": 0.0,
   "logical_used": 593920.0,
   "pg_autoscale_mode": "on",
   "pg_num_final": 1,
   "pg_num_ideal": 0,
   "pg_num_target": 1,
   "pool_id": 2,
   "pool_name": ".mgr",
   "raw_used": 1781760,
   "raw_used_rate": 3.0,
   "subtree_capacity": 257698037760,
   "target_bytes": 0,
   "target_ratio": 0.0,
   "would_adjust": false
  }
 ],
 "progress": {
  "completed": [
   {
    "add_to_ceph_s:": false,
    "finished_at": 1795391103.602619,
    "id": "00000000-0000-4000-8000-000000000009",
    "message": "PG autoscaler increasing pool 1 PGs from 1 to 32",
    "refs": [
     [
      "pool",
      1
     ]
    ],
    "started_at": 1795391103.6020293
   },
   {
    "add_to_ceph_s:": false,
    "finished_at": 1795391251.8961875,
    "id": "00000000-0000-4000-8000-000000000005",
    "message": "Removing image vm-pool/1139b87a0589 from trash",
    "refs": {
     "action": "trash remove",
     "image_id": "1139b87a0589",
     "origin": "rbd_support",
     "pool_name": "vm-pool",
     "pool_namespace": ""
    },
    "started_at": 1795391251.8684368
   },
   {
    "add_to_ceph_s:": false,
    "finished_at": 1795391575.7144852,
    "id": "00000000-0000-4000-8000-000000000002",
    "message": "Removing image vm-pool/113913443181 from trash",
    "refs": {
     "action": "trash remove",
     "image_id": "113913443181",
     "origin": "rbd_support",
     "pool_name": "vm-pool",
     "pool_namespace": ""
    },
    "started_at": 1795391575.6680682
   }
  ],
  "events": []
 },
 "config": [
  {
   "section": "global",
   "name": "log_to_file",
   "value": "false",
   "level": "basic",
   "can_update_at_runtime": true,
   "mask": ""
  },
  {
   "section": "global",
   "name": "mon_allow_pool_delete",
   "value": "true",
   "level": "advanced",
   "can_update_at_runtime": true,
   "mask": ""
  },
  {
   "section": "global",
   "name": "mon_allow_pool_size_one",
   "value": "true",
   "level": "advanced",
   "can_update_at_runtime": true,
   "mask": ""
  },
  {
   "section": "global",
   "name": "mon_cluster_log_file",
   "value": "",
   "level": "advanced",
   "can_update_at_runtime": true,
   "mask": ""
  },
  {
   "section": "mon",
   "name": "auth_allow_insecure_global_id_reclaim",
   "value": "false",
   "level": "advanced",
   "can_update_at_runtime": true,
   "mask": ""
  },
  {
   "section": "mgr",
   "name": "mgr/dashboard/MULTICLUSTER_CONFIG",
   "value": "<redacted: the dashboard keeps session tokens here>",
   "level": "advanced",
   "can_update_at_runtime": false,
   "mask": ""
  }
 ]
};
