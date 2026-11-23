/*
 * Activity: every operation started from Cairn (an OSD marked out, a flag
 * set, a pool created, a snapshot taken…) with its outcome, newest first.
 * Kept per Headlamp cluster in localStorage (the last 200), shown by the
 * activity strip in the shell and the Activity view.
 */

import React from 'react';
import { CephError } from './bridge';
import { currentCluster, errorText } from './client';

export type OpStatus = 'running' | 'done' | 'failed';

export interface Op {
  id: string;
  /** What was asked, in words: "Mark osd.3 out". */
  title: string;
  /** The object it acted on, for filtering: "osd.3", "pool vm-pool". */
  target?: string;
  /** The command or API call, for the record. */
  detail?: string;
  status: OpStatus;
  /** Ceph's or the API server's answer. */
  message?: string;
  started: number;
  ended?: number;
}

const MAX = 200;
let cluster = '';
let ops: Op[] = [];
const listeners = new Set<() => void>();

function storageKey(c: string) {
  return `cairn.activity.${c}`;
}

function load(c: string) {
  try {
    const raw = window.localStorage.getItem(storageKey(c));
    ops = raw ? (JSON.parse(raw) as Op[]) : [];
    // Anything "running" from an earlier page is unknown now.
    ops = ops.map(o => (o.status === 'running' ? { ...o, status: 'failed', message: 'The page closed before the answer came' } : o));
  } catch {
    ops = [];
  }
}

function save() {
  try {
    window.localStorage.setItem(storageKey(cluster), JSON.stringify(ops.slice(0, MAX)));
  } catch {
    /* storage full or unavailable: keep in memory */
  }
}

function emit() {
  ops = [...ops];
  listeners.forEach(l => l());
}

function ensureCluster() {
  const c = currentCluster();
  if (c !== cluster) {
    cluster = c;
    load(c);
  }
}

export const activity = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  snapshot(): Op[] {
    ensureCluster();
    return ops;
  },
  clear() {
    ensureCluster();
    ops = ops.filter(o => o.status === 'running');
    save();
    emit();
  },
};

/**
 * Runs an operation and records it. `run` returns the message to show on
 * success (Ceph's status line, "Created"…). Errors are recorded and
 * rethrown, so dialogs can stay open and show them.
 */
export async function runOp(o: { title: string; target?: string; detail?: string; run: () => Promise<string | void> }): Promise<string> {
  ensureCluster();
  const op: Op = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: o.title,
    target: o.target,
    detail: o.detail,
    status: 'running',
    started: Date.now(),
  };
  ops = [op, ...ops].slice(0, MAX);
  emit();
  const update = (p: Partial<Op>) => {
    ops = ops.map(x => (x.id === op.id ? { ...x, ...p } : x));
    save();
    emit();
  };
  try {
    const msg = (await o.run()) || 'Done';
    update({ status: 'done', message: msg, ended: Date.now() });
    return msg;
  } catch (e) {
    const msg = e instanceof CephError ? e.message : errorText(e);
    update({ status: 'failed', message: msg, ended: Date.now() });
    throw new Error(msg);
  }
}

export function useActivity(): Op[] {
  return React.useSyncExternalStore(activity.subscribe, activity.snapshot);
}
