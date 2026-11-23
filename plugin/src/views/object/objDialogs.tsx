/*
 * Create an object store, a user, a bucket StorageClass and a bucket
 * claim: forms that hand the object to the change preview.
 */

import Box from '@mui/material/Box';
import React from 'react';
import { useKube } from '../../api/kube';
import { createBucketClass, createClaim, createStore, createUser } from '../../api/objectOps';
import {
  bucketClaimObj,
  bucketClassObj,
  bucketNameProblem,
  DEFAULT_STORE_FORM,
  isBucketClass,
  nameProblem,
  objectStoreCR,
  objectUserCR,
  storeClasses,
  StoreForm,
  storeFormProblems,
  storeUsersOf,
  USER_CAPS,
  UserForm,
  userFormProblems,
} from '../../model/object';
import { Obj } from '../../model/types';
import { Check, Choice, Field, FormDialog, FormSection, NumField, openForm, Row, useOsdHosts } from '../cephfs/formkit';

export const openCreateStore = () => openForm(close => <CreateStoreDialog close={close} />);
export const openCreateUser = (store?: string) => openForm(close => <CreateUserDialog close={close} store={store} />);
export const openCreateClass = (store?: string) => openForm(close => <CreateClassDialog close={close} store={store} />);
export const openCreateClaim = (store?: string) => openForm(close => <CreateClaimDialog close={close} store={store} />);

function CreateStoreDialog({ close }: { close: () => void }) {
  const kube = useKube();
  const hosts = useOsdHosts();
  const [f, setF] = React.useState<StoreForm>({ ...DEFAULT_STORE_FORM, namespace: kube.ns });
  const [tried, setTried] = React.useState(false);
  const set = (p: Partial<StoreForm>) => setF(x => ({ ...x, ...p }));
  const taken = new Set(kube.objectStores.items.filter(s => s.metadata.namespace === kube.ns).map(s => s.metadata.name));
  const all = storeFormProblems(f, taken, hosts);
  const problems = tried ? all : f.name ? { name: all.name } : {};
  const submit = async () => {
    setTried(true);
    if (Object.keys(all).length) return;
    if (await createStore(objectStoreCR(f))) close();
  };
  return (
    <FormDialog
      title="Create object store"
      intro={`An S3-compatible object store in ${kube.ns}: Rook creates its pools and runs Ceph's RADOS Gateway (RGW) behind a Service. Apps then get buckets through ObjectBucketClaims or users.`}
      onClose={close}
      onSubmit={submit}
      wide
    >
      <Row>
        <Field label="Name" name="store-name" value={f.name} onChange={name => set({ name })} problem={problems.name} help={f.name ? `Service rook-ceph-rgw-${f.name}, pools ${f.name}.rgw.*` : 'Lowercase, like s3'} />
        <Choice
          label="Failure domain"
          value={f.failureDomain}
          onChange={failureDomain => set({ failureDomain })}
          options={[
            { value: 'host', label: 'Host: copies on different hosts' },
            { value: 'osd', label: 'OSD: copies may share a host' },
          ]}
          help={`${hosts} host${hosts === 1 ? '' : 's'} with OSDs`}
        />
      </Row>
      <FormSection>Pools</FormSection>
      <Row cols={3}>
        <NumField label="Metadata replicas" value={f.metadataSize} onChange={metadataSize => set({ metadataSize })} problem={problems.metadataSize} help="Index, log, users…" />
        <Choice
          label="Object data"
          value={f.dataEc ? 'ec' : 'rep'}
          onChange={v => set({ dataEc: v === 'ec' ? { k: 2, m: 1 } : null })}
          options={[
            { value: 'rep', label: 'Replicas' },
            { value: 'ec', label: 'Erasure coding' },
          ]}
          problem={problems.data}
        />
        {f.dataEc ? (
          <Row>
            <NumField label="Data" value={f.dataEc.k} onChange={k => set({ dataEc: { k, m: f.dataEc?.m ?? 1 } })} />
            <NumField label="Coding" value={f.dataEc.m} onChange={m => set({ dataEc: { k: f.dataEc?.k ?? 2, m } })} />
          </Row>
        ) : (
          <NumField label="Data replicas" value={f.dataSize} onChange={dataSize => set({ dataSize })} />
        )}
      </Row>
      <FormSection>Gateways</FormSection>
      <Row>
        <NumField label="Port" name="store-port" value={f.port} onChange={port => set({ port })} problem={problems.port} help="HTTP port of the Service" />
        <NumField label="Gateways" name="store-instances" value={f.instances} onChange={instances => set({ instances })} problem={problems.instances} help="RGW pods; two or more for availability" />
      </Row>
      <Row cols={3}>
        <Field label="CPU request" name="store-cpu" value={f.cpuRequest} onChange={cpuRequest => set({ cpuRequest })} problem={problems.cpuRequest} mono />
        <Field label="Memory request" name="store-mem" value={f.memRequest} onChange={memRequest => set({ memRequest })} problem={problems.memRequest} mono />
        <Field label="Memory limit" name="store-memlimit" value={f.memLimit} onChange={memLimit => set({ memLimit })} problem={problems.memLimit} mono />
      </Row>
      <Check
        label="Keep the pools when this resource is deleted"
        name="store-preserve"
        help="preservePoolsOnDelete: deleting the CephObjectStore then leaves its pools and every object in Ceph. Off: deleting it deletes them."
        checked={f.preservePools}
        onChange={preservePools => set({ preservePools })}
      />
    </FormDialog>
  );
}

const CAP_LABEL: Record<string, string> = {
  users: 'Users',
  buckets: 'Buckets',
  metadata: 'Metadata',
  usage: 'Usage',
  zone: 'Zone',
  info: 'Info',
  roles: 'Roles',
  'user-policy': 'User policy',
};

function CreateUserDialog({ close, store }: { close: () => void; store?: string }) {
  const kube = useKube();
  const stores = kube.objectStores.items.filter(s => s.metadata.namespace === kube.ns);
  const [f, setF] = React.useState<UserForm>({
    name: '',
    namespace: kube.ns,
    store: store ?? stores[0]?.metadata.name ?? '',
    displayName: '',
    caps: {},
    maxBuckets: '',
    maxSize: '',
    maxObjects: '',
  });
  const [tried, setTried] = React.useState(false);
  const set = (p: Partial<UserForm>) => setF(x => ({ ...x, ...p }));
  const storeObj = stores.find(s => s.metadata.name === f.store);
  const taken = new Set(storeObj ? storeUsersOf(storeObj, kube.objectUsers.items).map(u => u.metadata.name) : []);
  const all = userFormProblems(f, taken);
  const problems = tried ? all : f.name ? { name: all.name } : {};
  const submit = async () => {
    setTried(true);
    if (Object.keys(all).length) return;
    if (await createUser(objectUserCR(f))) close();
  };
  return (
    <FormDialog
      title="Create user"
      intro="An S3 user with its own keys, which Rook writes to a Secret. Admin capabilities let a tool manage other users or buckets; most applications need none."
      onClose={close}
      onSubmit={submit}
      wide
    >
      <Row>
        <Choice label="Object store" value={f.store} onChange={s => set({ store: s })} options={stores.map(s => ({ value: s.metadata.name, label: s.metadata.name }))} problem={problems.store} />
        <Field label="User ID" name="user-name" value={f.name} onChange={name => set({ name })} problem={problems.name} help="The resource name and the S3 user ID" />
      </Row>
      <Field label="Display name" name="user-display" value={f.displayName} onChange={displayName => set({ displayName })} help="Shown in tools; the user ID when empty" />
      <FormSection>Admin capabilities</FormSection>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, minmax(0, 1fr))' } }}>
        {USER_CAPS.map(c => (
          <Choice
            key={c}
            label={CAP_LABEL[c] ?? c}
            value={f.caps[c] ?? ''}
            onChange={v => set({ caps: { ...f.caps, [c]: v as any } })}
            options={[
              { value: '', label: 'None' },
              { value: 'read', label: 'Read' },
              { value: 'write', label: 'Write' },
              { value: 'read, write', label: 'Read and write' },
              { value: '*', label: 'All' },
            ]}
          />
        ))}
      </Box>
      <FormSection>Quotas</FormSection>
      <Row cols={3}>
        <Field label="Buckets" name="user-maxbuckets" value={f.maxBuckets} onChange={maxBuckets => set({ maxBuckets })} problem={problems.maxBuckets} help="Empty: Ceph's default (1000)" inputMode="numeric" />
        <Field label="Size" name="user-maxsize" value={f.maxSize} onChange={maxSize => set({ maxSize })} problem={problems.maxSize} help="Empty: no limit; like 10Gi" mono />
        <Field label="Objects" name="user-maxobjects" value={f.maxObjects} onChange={maxObjects => set({ maxObjects })} problem={problems.maxObjects} help="Empty: no limit" inputMode="numeric" />
      </Row>
    </FormDialog>
  );
}

function CreateClassDialog({ close, store }: { close: () => void; store?: string }) {
  const kube = useKube();
  const stores = kube.objectStores.items.filter(s => s.metadata.namespace === kube.ns);
  const [name, setName] = React.useState('');
  const [st, setSt] = React.useState(store ?? stores[0]?.metadata.name ?? '');
  const [reclaim, setReclaim] = React.useState<'Delete' | 'Retain'>('Delete');
  const [tried, setTried] = React.useState(false);
  const taken = new Set(kube.storageClasses.items.map(s => s.metadata.name));
  const p: Record<string, string> = {};
  const n = nameProblem(name);
  if (n) p.name = n;
  else if (taken.has(name)) p.name = `A StorageClass ${name} exists already.`;
  if (!st) p.store = 'Pick an object store.';
  const shown = tried ? p : name ? { name: p.name } : {};
  const submit = async () => {
    setTried(true);
    if (Object.keys(p).length) return;
    if (await createBucketClass(bucketClassObj({ name, rookNs: kube.ns, store: st, storeNs: kube.ns, reclaim }))) close();
  };
  return (
    <FormDialog
      title="Create bucket StorageClass"
      intro={`ObjectBucketClaims name a StorageClass to get a bucket. This one sends them to an object store, through the Rook bucket provisioner ${kube.ns}.ceph.rook.io/bucket.`}
      onClose={close}
      onSubmit={submit}
    >
      <Row>
        <Field label="Name" name="class-name" value={name} onChange={setName} problem={shown.name} help="Cluster-wide" />
        <Choice label="Object store" value={st} onChange={setSt} options={stores.map(s => ({ value: s.metadata.name, label: s.metadata.name }))} problem={shown.store} />
      </Row>
      <Choice<'Delete' | 'Retain'>
        label="When a claim is deleted"
        value={reclaim}
        onChange={setReclaim}
        options={[
          { value: 'Delete', label: 'Delete its bucket and objects' },
          { value: 'Retain', label: 'Keep its bucket' },
        ]}
      />
    </FormDialog>
  );
}

function CreateClaimDialog({ close, store }: { close: () => void; store?: string }) {
  const kube = useKube();
  const stores = kube.objectStores.items.filter(s => s.metadata.namespace === kube.ns);
  const storeObj: Obj | undefined = stores.find(s => s.metadata.name === store);
  const classes = (storeObj ? storeClasses(storeObj, kube.storageClasses.items) : kube.storageClasses.items.filter(isBucketClass)).map(s => s.metadata.name);
  const [f, setF] = React.useState({ name: '', namespace: '', storageClass: classes[0] ?? '', bucketName: '', maxObjects: '', maxSize: '' });
  const [tried, setTried] = React.useState(false);
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }));
  const p: Record<string, string> = {};
  const n = nameProblem(f.name);
  if (n) p.name = n;
  else if (kube.bucketClaims.items.some(o => o.metadata.namespace === f.namespace && o.metadata.name === f.name)) p.name = `${f.namespace}/${f.name} exists already.`;
  const nsP = nameProblem(f.namespace);
  if (nsP) p.namespace = f.namespace ? nsP : 'The namespace of the app that uses the bucket.';
  if (!f.storageClass) p.storageClass = 'Create a bucket StorageClass first.';
  const b = bucketNameProblem(f.bucketName);
  if (b) p.bucketName = b;
  if (f.maxObjects && !/^\d+$/.test(f.maxObjects)) p.maxObjects = 'A whole number.';
  if (f.maxSize && !/^\d+(\.\d+)?[KMGTP]i?$/.test(f.maxSize)) p.maxSize = 'Like 2G or 500M.';
  const shown = tried ? p : f.name ? { name: p.name } : {};
  const submit = async () => {
    setTried(true);
    if (Object.keys(p).length) return;
    const sc = kube.storageClasses.items.find(s => s.metadata.name === f.storageClass);
    if (await createClaim(bucketClaimObj(f), sc)) close();
  };
  return (
    <FormDialog
      title="Create bucket claim"
      intro="An ObjectBucketClaim asks for a bucket the way a PVC asks for a volume. The provisioner creates the bucket and a user, and writes the address and keys to a ConfigMap and a Secret named after the claim, for the app's pods."
      onClose={close}
      onSubmit={submit}
    >
      <Row>
        <Field label="Namespace" name="obc-ns" value={f.namespace} onChange={namespace => set({ namespace })} problem={shown.namespace} help="Where the app runs" />
        <Field label="Name" name="obc-name" value={f.name} onChange={name => set({ name })} problem={shown.name} help="Also the Secret and ConfigMap name" />
      </Row>
      <Row>
        <Choice label="StorageClass" value={f.storageClass} onChange={storageClass => set({ storageClass })} options={classes.map(c => ({ value: c, label: c }))} problem={shown.storageClass} />
        <Field label="Bucket name" name="obc-bucket" value={f.bucketName} onChange={bucketName => set({ bucketName })} problem={shown.bucketName} help="Empty: the name plus a random suffix" mono />
      </Row>
      <Row>
        <Field label="Maximum objects" name="obc-maxobjects" value={f.maxObjects} onChange={maxObjects => set({ maxObjects })} problem={shown.maxObjects} help="Empty: no limit" inputMode="numeric" />
        <Field label="Maximum size" name="obc-maxsize" value={f.maxSize} onChange={maxSize => set({ maxSize })} problem={shown.maxSize} help="Empty: no limit; like 2G" mono />
      </Row>
    </FormDialog>
  );
}
