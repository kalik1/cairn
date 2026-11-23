/*
 * Create a file system (CephFilesystem) and a subvolume group
 * (CephFilesystemSubVolumeGroup): forms that hand the resource to the
 * change preview.
 */

import { Icon } from '@iconify/react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { createFilesystem, createSubvolumeGroup } from '../../api/fsOps';
import { useKube } from '../../api/kube';
import {
  DEFAULT_FS_FORM,
  DEFAULT_SVG_FORM,
  filesystemCR,
  FsForm,
  fsFormProblems,
  mdsPodCount,
  quantityBytes,
  rookFsPools,
  subvolumeGroupCR,
  SvgForm,
  svgFormProblems,
  svgGroupName,
} from '../../model/cephfs';
import { bytes } from '../../model/format';
import { Obj } from '../../model/types';
import { Check, Choice, Field, FormDialog, FormSection, NumField, openForm, Row, useOsdHosts } from './formkit';
import { useFsMap } from './fsParts';

export function openCreateFs() {
  openForm(close => <CreateFsDialog close={close} />);
}

export function openCreateSvg(fs?: string) {
  openForm(close => <CreateSvgDialog close={close} fs={fs} />);
}

function CreateFsDialog({ close }: { close: () => void }) {
  const kube = useKube();
  const ceph = useCeph();
  const hosts = useOsdHosts();
  const { filesystems } = useFsMap();
  const [f, setF] = React.useState<FsForm>({ ...DEFAULT_FS_FORM, namespace: kube.ns });
  const [tried, setTried] = React.useState(false);
  const set = (p: Partial<FsForm>) => setF(x => ({ ...x, ...p }));
  const taken = new Set([...kube.filesystems.items.map(x => x.metadata.name), ...filesystems.map(x => x.name)]);
  const all = fsFormProblems(f, taken, hosts);
  const problems = tried ? all : f.name ? { name: all.name } : {};
  const classes = [...new Set(ceph.core.osds.map(o => o.deviceClass).filter(Boolean))].sort();
  const cr = filesystemCR(f);
  const pools = rookFsPools(cr);
  const pods = mdsPodCount(cr);
  const memEach = quantityBytes(f.memRequest);

  const submit = async () => {
    setTried(true);
    if (Object.keys(all).length) return;
    const ok = await createFilesystem(cr, { mdsPods: pods });
    if (ok) close();
  };

  const setPool = (i: number, p: Partial<FsForm['dataPools'][number]>) => set({ dataPools: f.dataPools.map((d, j) => (j === i ? { ...d, ...p } : d)) });

  return (
    <FormDialog
      title="Create file system"
      intro={`A CephFS file system in ${kube.ns}: Rook creates its pools and runs its metadata servers (MDS). Pods mount it through the CephFS CSI driver.`}
      onClose={close}
      onSubmit={submit}
      wide
    >
      <Row>
        <Field label="Name" name="fs-name" value={f.name} onChange={name => set({ name })} problem={problems.name} help={f.name ? `Pools ${pools.metadata}, ${pools.data.join(', ')}` : 'Lowercase, like shared-fs'} />
        <Choice
          label="Failure domain"
          value={f.failureDomain}
          onChange={failureDomain => set({ failureDomain })}
          options={[
            { value: 'host', label: 'Host: replicas on different hosts' },
            { value: 'osd', label: 'OSD: replicas may share a host' },
          ]}
          help={`${hosts} host${hosts === 1 ? '' : 's'} with OSDs`}
        />
      </Row>
      <Row>
        <NumField label="Metadata replicas" value={f.metadataSize} onChange={metadataSize => set({ metadataSize })} problem={problems.metadataSize} help="Pool for directories and file names" />
        <Choice
          label="Device class"
          value={f.deviceClass}
          onChange={deviceClass => set({ deviceClass })}
          options={[{ value: '', label: 'Any' }, ...classes.map(c => ({ value: c, label: c }))]}
          help="Which OSDs hold the pools"
        />
      </Row>

      <FormSection>Data pools</FormSection>
      {f.dataPools.map((d, i) => (
        <Box key={i} sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) auto' }, alignItems: 'start' }}>
          <Field label="Pool name" name={`fs-pool-${i}`} value={d.name} onChange={name => setPool(i, { name })} problem={problems[`pool${i}`]} help={i === 0 ? 'Default data pool' : 'Extra data pool'} />
          <Choice
            label="Protection"
            value={d.ec ? 'ec' : 'rep'}
            onChange={v => setPool(i, v === 'ec' ? { ec: { k: 2, m: 1 } } : { ec: undefined })}
            options={[
              { value: 'rep', label: 'Replicas' },
              ...(i > 0 ? [{ value: 'ec' as const, label: 'Erasure coding' }] : []),
            ]}
          />
          {d.ec ? (
            <Row>
              <NumField label="Data" value={d.ec.k} onChange={k => setPool(i, { ec: { k, m: d.ec?.m ?? 1 } })} />
              <NumField label="Coding" value={d.ec.m} onChange={m => setPool(i, { ec: { k: d.ec?.k ?? 2, m } })} />
            </Row>
          ) : (
            <NumField label="Replicas" value={d.size} onChange={size => setPool(i, { size })} />
          )}
          <Box sx={{ pt: 0.5 }}>
            <IconButton aria-label={`Remove data pool ${d.name}`} disabled={f.dataPools.length === 1} onClick={() => set({ dataPools: f.dataPools.filter((_, j) => j !== i) })} size="small">
              <Icon icon="mdi:close" width={18} />
            </IconButton>
          </Box>
        </Box>
      ))}
      <Box>
        <Button size="small" startIcon={<Icon icon="mdi:plus" width={16} />} onClick={() => set({ dataPools: [...f.dataPools, { name: `data${f.dataPools.length}`, size: Math.min(3, hosts) }] })} sx={{ textTransform: 'none' }}>
          Add data pool
        </Button>
      </Box>

      <FormSection>Metadata servers</FormSection>
      <Row>
        <NumField label="Active MDS" value={f.activeCount} onChange={activeCount => set({ activeCount })} problem={problems.activeCount} help="One is enough for most; more ranks share a busy tree" />
        <Check
          label="Standby-replay"
          help="Rook adds a standby per rank that follows its journal: failover in seconds, twice the MDS pods. Off: no standby; a failed MDS waits for Kubernetes to restart it."
          name="fs-standby"
          checked={f.activeStandby}
          onChange={activeStandby => set({ activeStandby })}
        />
      </Row>
      <Row cols={3}>
        <Field label="CPU request" name="fs-cpu" value={f.cpuRequest} onChange={cpuRequest => set({ cpuRequest })} problem={problems.cpuRequest} mono />
        <Field label="Memory request" name="fs-mem" value={f.memRequest} onChange={memRequest => set({ memRequest })} problem={problems.memRequest} mono />
        <Field label="Memory limit" name="fs-memlimit" value={f.memLimit} onChange={memLimit => set({ memLimit })} problem={problems.memLimit} help="The MDS cache is sized from it" mono />
      </Row>
      <Box sx={{ fontSize: 13, color: 'text.secondary', mt: -1 }}>
        Rook runs {pods} MDS pods{memEach ? `: ${bytes(memEach * pods)} of memory requested in all` : ''}.
      </Box>
      <Check
        label="Keep the file system when this resource is deleted"
        help="preserveFilesystemOnDelete: deleting the CephFilesystem then leaves the file system, its pools and files in Ceph. Off: deleting it deletes every file."
        name="fs-preserve"
        checked={f.preserve}
        onChange={preserve => set({ preserve })}
      />
    </FormDialog>
  );
}

function CreateSvgDialog({ close, fs }: { close: () => void; fs?: string }) {
  const kube = useKube();
  const crs = kube.filesystems.items.filter(x => x.metadata.namespace === kube.ns);
  const [f, setF] = React.useState<SvgForm>({ ...DEFAULT_SVG_FORM, namespace: kube.ns, filesystem: fs ?? crs[0]?.metadata.name ?? '' });
  const [tried, setTried] = React.useState(false);
  const set = (p: Partial<SvgForm>) => setF(x => ({ ...x, ...p }));
  const takenCrs = new Set(kube.subVolumeGroups.items.filter(x => x.metadata.namespace === kube.ns).map(x => x.metadata.name));
  const groupsInFs = new Set(kube.subVolumeGroups.items.filter(x => x.spec?.filesystemName === f.filesystem).map(svgGroupName));
  const all = svgFormProblems(f, takenCrs, groupsInFs);
  const problems = tried ? all : f.name ? { name: all.name, groupName: all.groupName } : {};
  const fsCr: Obj | undefined = crs.find(x => x.metadata.name === f.filesystem);
  const dataPools = fsCr ? rookFsPools(fsCr).data : [];

  const submit = async () => {
    setTried(true);
    if (Object.keys(all).length) return;
    const ok = await createSubvolumeGroup(subvolumeGroupCR(f), {});
    if (ok) close();
  };

  return (
    <FormDialog
      title="Create subvolume group"
      intro="A subvolume group is a directory tree in a file system with its own quota, data pool and MDS pinning. Ceph-CSI creates the subvolumes of Kubernetes volumes in a group."
      onClose={close}
      onSubmit={submit}
    >
      <Row>
        <Choice
          label="File system"
          value={f.filesystem}
          onChange={filesystem => set({ filesystem, dataPoolName: '' })}
          options={crs.map(x => ({ value: x.metadata.name, label: x.metadata.name }))}
          problem={problems.filesystem}
          help={crs.length ? undefined : 'Create a file system first'}
        />
        <Field label="Name" name="svg-name" value={f.name} onChange={name => set({ name })} problem={problems.name} help="The resource name" />
      </Row>
      <Row>
        <Field label="Ceph group name" name="svg-group" value={f.groupName} onChange={groupName => set({ groupName })} problem={problems.groupName} help="Leave empty to use the name" mono />
        <Field label="Quota" name="svg-quota" value={f.quota} onChange={quota => set({ quota })} problem={problems.quota} help="Empty for none, or like 100Gi" mono />
      </Row>
      <Row>
        <Choice
          label="Pinning"
          value={f.pinning}
          onChange={pinning => set({ pinning })}
          options={[
            { value: 'distributed', label: 'Distributed across active MDS' },
            { value: 'none', label: 'None' },
          ]}
          help="With one active MDS this changes nothing"
        />
        <Choice
          label="Data pool"
          value={f.dataPoolName}
          onChange={dataPoolName => set({ dataPoolName })}
          options={[{ value: '', label: 'The default data pool' }, ...dataPools.map(p => ({ value: p, label: p }))]}
        />
      </Row>
    </FormDialog>
  );
}
