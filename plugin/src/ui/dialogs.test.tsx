import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { confirm, DialogHost, INFO_CLOSE } from './dialogs';

/** Opens a dialog through the shell's host, as the views do; `answer` settles when it closes. */
async function open<T>(show: () => Promise<T>): Promise<{ answer: Promise<T> }> {
  render(<DialogHost />);
  let answer!: Promise<T>;
  await act(async () => {
    answer = show();
  });
  return { answer };
}

describe('confirm(), information only', () => {
  it('has one button, "Close" by default, and resolves null', async () => {
    const { answer } = await open(() =>
      confirm({
        infoOnly: true,
        title: 'Pool rbd cannot be deleted yet',
        body: 'Clear these first:',
        consequences: ['StorageClass ceph-rbd uses it'],
        footer: 'Then come back.',
      })
    );
    expect(INFO_CLOSE).toBe('Close');
    expect(screen.getByRole('dialog', { name: 'Pool rbd cannot be deleted yet' })).toBeTruthy();
    expect(screen.getByText('Clear these first:')).toBeTruthy();
    expect(screen.getByRole('listitem').textContent).toBe('StorageClass ceph-rbd uses it');
    expect(screen.getByText('Then come back.')).toBeTruthy();
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Close']);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await expect(answer).resolves.toBeNull();
  });

  it('takes its own label', async () => {
    const { answer } = await open(() => confirm({ infoOnly: true, title: 'Why not', confirm: 'Got it' }));
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Got it']);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await expect(answer).resolves.toBeNull();
  });
});

describe('confirm(), a question', () => {
  it('keeps Cancel and its label, and resolves with the option', async () => {
    const { answer } = await open(() => confirm({ title: 'Mark osd.1 out', confirm: 'Mark out' }));
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Cancel', 'Mark out']);
    fireEvent.click(screen.getByRole('button', { name: 'Mark out' }));
    await expect(answer).resolves.toEqual({ option: false });
  });

  it('resolves null on Cancel', async () => {
    const { answer } = await open(() => confirm({ title: 'Mark osd.1 out', confirm: 'Mark out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(answer).resolves.toBeNull();
  });
});
