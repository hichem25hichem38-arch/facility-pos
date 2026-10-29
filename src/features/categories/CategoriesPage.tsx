import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/database/db';
import { Button, Card, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal, PageHeader, SearchInput } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useT } from '@/hooks/useT';
import { newId, syncMeta } from '@/utils/helpers';
import { toastError, toastSuccess } from '@/app/store/toast.store';
import type { Category } from '@/types';

export function CategoriesPage() {
  const { t } = useT();
  const [term, setTerm] = useState('');
  const [draft, setDraft] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);

  const categories = useLiveQuery(() => getDb().categories.orderBy('name').toArray(), [], []);
  const counts = useLiveQuery(async () => {
    const rows = await getDb().products.toArray();
    const map = new Map<string, number>();
    for (const p of rows) {
      if (!p.categoryId) continue;
      map.set(p.categoryId, (map.get(p.categoryId) ?? 0) + 1);
    }
    return map;
  }, [], new Map<string, number>());

  const visible = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, term]);

  const openAdd = () => { setDraft({} as Category); setName(''); setError(''); };
  const openEdit = (c: Category) => { setDraft(c); setName(c.name); setError(''); };

  const save = async () => {
    if (!draft) return;
    const value = name.trim();
    if (!value) { setError(t('categoryNameRequired')); return; }
    const clash = categories.find((c) => c.name.toLowerCase() === value.toLowerCase() && c.id !== draft.id);
    if (clash) { setError(t('categoryNameExists')); return; }
    const db = getDb();
    const meta = await syncMeta();
    try {
      if (draft.id) {
        await db.categories.update(draft.id, { name: value, updatedAt: Date.now(), version: (draft.version ?? 1) + 1 });
        toastSuccess(t('updatedOk'));
      } else {
        await db.categories.add({ id: newId(), name: value, createdAt: Date.now(), updatedAt: Date.now(), ...meta });
        toastSuccess(t('addedOk'));
      }
      setDraft(null);
    } catch (e) {
      toastError(e instanceof Error ? e.message : t('errorGeneric'));
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    const db = getDb();
    try {
      await db.transaction('rw', db.categories, db.products, async () => {
        await db.products.where('categoryId').equals(pendingDelete.id).modify({ categoryId: undefined, updatedAt: Date.now() });
        await db.categories.delete(pendingDelete.id);
      });
      toastSuccess(t('deletedOk'));
    } catch (e) {
      toastError(e instanceof Error ? e.message : t('errorGeneric'));
    }
    setPendingDelete(null);
  };

  return (
    <>
      <PageHeader
        icon="tag"
        title={t('categories')}
        subtitle={t('categoriesHint')}
        actions={<Button icon="plus" onClick={openAdd}>{t('addCategory')}</Button>}
      />

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput value={term} onChange={setTerm} placeholder={t('search')} className="min-w-52 flex-1" />
          <span className="num text-[0.74rem] font-bold text-ink-muted">
            {t('totalRecords', { count: categories.length })}
          </span>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon="tag"
            title={term ? t('noResults') : t('categoriesEmpty')}
            hint={term ? undefined : t('categoriesHint')}
            action={!term ? <Button icon="plus" onClick={openAdd}>{t('addCategory')}</Button> : undefined}
          />
        ) : (
          <ul className="grid gap-2.5 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((c) => (
              <li
                key={c.id}
                className="group flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-3 transition-all duration-150 hover:border-line-strong hover:bg-surface"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-brand/12 text-brand">
                  <Icon name="tag" size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.9rem] font-extrabold text-ink">{c.name}</p>
                  <p className="num mt-0.5 text-[0.72rem] font-bold text-ink-muted">
                    {t('productsCount', { count: counts.get(c.id) ?? 0 })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
                  <IconButton icon="edit" label={t('edit')} size={30} onClick={() => openEdit(c)} />
                  <IconButton icon="trash" label={t('delete')} size={30} variant="danger" onClick={() => setPendingDelete(c)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? t('editCategory') : t('addCategory')}
        icon="tag"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>{t('cancel')}</Button>
            <Button icon="save" onClick={save}>{t('save')}</Button>
          </>
        }
      >
        <Field label={t('name')} required error={error}>
          <Input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} autoFocus maxLength={60} />
        </Field>
      </Modal>

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={remove}
        title={t('delete')}
        message={t('deleteCategoryConfirm')}
        confirmLabel={t('delete')}
      />
    </>
  );
}
