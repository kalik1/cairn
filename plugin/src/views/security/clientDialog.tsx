/*
 * Create a CephClient: a name and caps for mon, osd, mgr and mds, with
 * presets for the common cases (RBD pool access, CephFS mount…).
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import React from 'react';
import { useCeph } from '../../api/ceph';
import { useKube } from '../../api/kube';
import { createClient } from '../../api/securityOps';
import { CAP_SERVICES, capProblem, CAPS_PRESETS, CapService, cephClientCR, nameProblem } from '../../model/cephx';
import { Choice, Field, FormDialog, FormSection, openForm, Row } from '../cephfs/formkit';

export const openCreateClient = () => openForm(close => <CreateClientDialog close={close} />);

function CreateClientDialog({ close }: { close: () => void }) {
  const kube = useKube();
  const ceph = useCeph();
  const [name, setName] = React.useState('');
  const [caps, setCaps] = React.useState<Partial<Record<CapService, string>>>({ mon: 'allow r' });
  const [preset, setPreset] = React.useState('');
  const [target, setTarget] = React.useState('');
  const [tried, setTried] = React.useState(false);
  const pools = ceph.core.pools.map(p => p.name).filter(n => !n.startsWith('.'));
  const fss = kube.filesystems.items.map(f => f.metadata.name);
  const p = CAPS_PRESETS.find(x => x.id === preset);
  const targets = p?.needs === 'pool' ? pools : p?.needs === 'fs' ? fss : [];

  const problems: Record<string, string> = {};
  const n = nameProblem(name);
  if (n) problems.name = n;
  else if (kube.clients.items.some(c => c.metadata.namespace === kube.ns && c.metadata.name === name)) problems.name = `A CephClient ${name} exists already.`;
  else if (['admin', 'crash', 'ceph-exporter'].includes(name) || name.startsWith('csi-') || name.startsWith('rbd-mirror')) problems.name = `${name} is a name Rook or Ceph uses.`;
  for (const s of CAP_SERVICES) {
    const c = capProblem(caps[s] ?? '');
    if (c) problems[s] = c;
  }
  if (!CAP_SERVICES.some(s => (caps[s] ?? '').trim())) problems.mon = 'Give the client at least one cap.';
  const shown = tried ? problems : name ? { name: problems.name } : {};

  const apply = (id: string, tgt: string) => {
    const pr = CAPS_PRESETS.find(x => x.id === id);
    if (!pr) return;
    if (pr.needs && !tgt) return;
    const c = pr.caps(tgt);
    setCaps({ mon: c.mon ?? '', osd: c.osd ?? '', mgr: c.mgr ?? '', mds: c.mds ?? '' });
  };

  const submit = async () => {
    setTried(true);
    if (Object.keys(problems).length) return;
    if (await createClient(cephClientCR({ name, namespace: kube.ns, caps }))) close();
  };

  return (
    <FormDialog
      title="Create CephClient"
      intro="A Ceph user for a consumer outside the cluster (a hypervisor, a backup tool, a CSI driver elsewhere). Rook creates it with these caps and writes its keyring to a Secret."
      onClose={close}
      onSubmit={submit}
      wide
    >
      <Field label="Name" name="client-name" value={name} onChange={setName} problem={shown.name} help={name ? `Ceph user client.${name}, Secret rook-ceph-client-${name}` : 'Lowercase, like backup'} />
      <FormSection>Caps</FormSection>
      <Row cols={3}>
        <Choice
          label="Start from"
          value={preset}
          onChange={v => {
            setPreset(v);
            const pr = CAPS_PRESETS.find(x => x.id === v);
            const first = pr?.needs === 'pool' ? pools[0] ?? '' : pr?.needs === 'fs' ? fss[0] ?? '' : '';
            setTarget(first);
            apply(v, first);
          }}
          options={[{ value: '', label: 'Write my own' }, ...CAPS_PRESETS.map(x => ({ value: x.id, label: x.label }))]}
          help={p?.help}
        />
        {p?.needs ? (
          <Choice
            label={p.needs === 'pool' ? 'Pool' : 'File system'}
            value={target}
            onChange={v => {
              setTarget(v);
              apply(preset, v);
            }}
            options={targets.map(x => ({ value: x, label: x }))}
            help={targets.length ? undefined : p.needs === 'pool' ? 'No pool yet' : 'No file system yet'}
          />
        ) : (
          <Box />
        )}
        <Box sx={{ pt: 0.5 }}>
          <Button size="small" onClick={() => setCaps({})} sx={{ textTransform: 'none' }}>
            Clear caps
          </Button>
        </Box>
      </Row>
      <Row>
        {CAP_SERVICES.map(s => (
          <Field
            key={s}
            label={s}
            name={`client-cap-${s}`}
            value={caps[s] ?? ''}
            onChange={v => setCaps(c => ({ ...c, [s]: v }))}
            problem={shown[s]}
            help={s === 'mon' ? 'Like allow r, or profile rbd' : s === 'osd' ? 'Like profile rbd pool=my-pool' : s === 'mgr' ? 'Like profile rbd pool=my-pool' : 'Like allow rw fsname=my-fs'}
            mono
          />
        ))}
      </Row>
    </FormDialog>
  );
}
