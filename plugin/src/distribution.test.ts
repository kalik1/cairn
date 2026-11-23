import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

// Each GitHub Release carries cairn-cluster.yaml, distribution/rbac.yaml as
// it is (.github/scripts/cluster-bundles.sh), which distributions install
// with the plugin (k4all v2.7.0 and later). It must apply on any cluster,
// whatever namespace Rook runs in: cluster-wide roles only, no binding.

interface K8sObject {
  kind: string;
  metadata: { name: string; namespace?: string };
}

const rbac = (yaml.loadAll(fs.readFileSync(path.resolve('..', 'distribution', 'rbac.yaml'), 'utf8')) as K8sObject[]).filter(
  Boolean
);

describe('cairn-cluster.yaml', () => {
  it('holds the three roles', () => {
    expect(rbac.filter(o => o.kind === 'ClusterRole').map(o => o.metadata.name)).toEqual(
      expect.arrayContaining(['cairn-viewer', 'cairn-editor', 'cairn-admin'])
    );
  });

  it('holds nothing namespaced and no binding', () => {
    expect(rbac.filter(o => o.metadata.namespace || o.kind !== 'ClusterRole').map(o => `${o.kind}/${o.metadata.name}`)).toEqual([]);
  });
});
