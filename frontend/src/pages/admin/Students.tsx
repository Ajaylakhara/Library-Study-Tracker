import { useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, UserPlus, Users } from 'lucide-react';
import { get, patch, post, del } from '../../store/api';
import { ENDPOINTS } from '../../config/endpoints';
import { errMsg } from '../../toolkit/createAppThunk';
import { useAppDispatch } from '../../hooks/useRedux';
import { showToast } from '../../toolkit/toastSlice';
import { useAdminHeader, useRefreshBadges } from '../../layout/AdminLayout';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/Button';
import { Input, SearchBox } from '../../components/Input';
import { PinInput } from '../../components/PinInput';
import { Checkbox } from '../../components/Controls';
import { Modal } from '../../components/Modal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { formatPhone, formatRupees } from '../../helper/formatMinutes';
import { dateLabel } from '../../helper/date';
import { cn } from '../../helper/cn';
import type { Pagination as P, ShiftHours, Student, UserStatus } from '../../types';

interface NewStudent extends Record<string, unknown> {
  name: string;
  phone: string;
  pin?: string;
  seatNumber: number;
  shiftHours: ShiftHours;
  monthlyFee: number;
  whatsappOptIn: boolean;
  smsOptIn: boolean;
}

interface SharePin {
  name: string;
  phone: string;
  pin: string;
}

type StudentTab = UserStatus | 'deleted';

const TABS: { key: StudentTab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'deleted', label: 'Deleted' },
];
const PAGE_SIZE = 10;

type Dialog =
  | { kind: 'approve'; s: Student }
  | { kind: 'edit'; s: Student }
  | { kind: 'pin'; s: Student }
  | { kind: 'status'; s: Student; to: UserStatus; title: string; text: string; label: string }
  | { kind: 'delete'; s: Student }
  | { kind: 'restore'; s: Student }
  | null;

export function Component() {
  const dispatch = useAppDispatch();
  const refreshBadges = useRefreshBadges();
  const [tab, setTab] = useState<StudentTab>('pending');
  const [search, setSearch] = useState('');
  const q = useDebounce(search.trim(), 400);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sharePin, setSharePin] = useState<SharePin | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => setPage(1), [tab, q]);

  const list = useAsync(async () => {
    const r = await get<Student[]>(ENDPOINTS.admin.students, {
      ...(tab === 'deleted' ? { includeDeleted: 'true' } : { status: tab }),
      search: q,
      page,
      limit: PAGE_SIZE,
    });
    return { rows: r.data, pagination: r.pagination as P };
  }, [tab, q, page]);

  const counts = useAsync(async () => {
    const all = await Promise.all(TABS.map((t) => get<Student[]>(ENDPOINTS.admin.students, {
      ...(t.key === 'deleted' ? { includeDeleted: 'true' } : { status: t.key }),
      limit: 1,
    })));
    return Object.fromEntries(TABS.map((t, i) => [t.key, all[i].pagination?.total ?? 0])) as Record<StudentTab, number>;
  }, []);

  const total = counts.data
    ? TABS.filter((item) => item.key !== 'deleted').reduce((sum, item) => sum + counts.data![item.key], 0)
    : null;
  useAdminHeader('Students', total == null ? undefined : `${total} registered · ${counts.data?.approved ?? 0} approved`);

  const changed = () => {
    list.refresh();
    counts.refresh();
    refreshBadges();
  };

  const addStudent = async (input: NewStudent) => {
    setAdding(true);
    try {
      const res = await post<{ student: Student; pin: string }>(ENDPOINTS.admin.createStudent, input);
      dispatch(showToast('success', 'Student added and approved.'));
      setAddOpen(false);
      setSearch('');
      setTab('approved');
      setPage(1);
      changed();
      setSharePin({ name: res.data.student.name, phone: res.data.student.phone, pin: res.data.pin });
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
    } finally {
      setAdding(false);
    }
  };

  const columns: Column<Student>[] = [
    {
      key: 'name',
      header: 'Name',
      primary: true,
      render: (s) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold">{s.name}</span>
          <span className="text-xs font-normal text-muted">
            {s.isDeleted
              ? 'Deleted'
              : s.status === 'pending'
                ? 'Registered'
                : s.status === 'approved'
                  ? 'Since'
                  : s.status === 'rejected'
                    ? 'Rejected'
                    : 'Blocked'}{' '}
            {dateLabel(s.isDeleted ? s.deletedAt ?? s.updatedAt : s.status === 'pending' || s.status === 'approved' ? s.createdAt : s.updatedAt)}
          </span>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', render: (s) => <span className="tnum">{formatPhone(s.phone)}</span> },
    {
      key: 'fee',
      header: 'Monthly fee',
      align: 'right',
      render: (s) => <span className="tnum">{s.monthlyFee ? formatRupees(s.monthlyFee) : '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (s) => s.isDeleted
        ? <span className="rounded-full bg-[#efe8da] px-2.5 py-1 text-xs font-semibold text-muted">Deleted</span>
        : <StatusBadge status={s.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      mobileHideLabel: true,
      render: (s) => (
        <div className="flex flex-wrap justify-end gap-2">
          {s.isDeleted && (
            <Button size="sm" onClick={() => setDialog({ kind: 'restore', s })}>
              Restore
            </Button>
          )}
          {!s.isDeleted && (s.status === 'pending' || s.status === 'rejected') && (
            <Button size="sm" onClick={() => setDialog({ kind: 'approve', s })}>
              Approve
            </Button>
          )}
          {!s.isDeleted && s.status === 'pending' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setDialog({
                  kind: 'status',
                  s,
                  to: 'rejected',
                  title: `Reject ${s.name}?`,
                  text: 'They will not be able to log in. You can approve them later from the Rejected tab.',
                  label: 'Reject',
                })
              }
            >
              Reject
            </Button>
          )}
          {(s.status === 'approved' || s.status === 'blocked' || s.status === 'rejected' ||
            (s.status === 'pending' && (s.seatNumber === undefined || s.shiftHours === undefined))) && !s.isDeleted && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'edit', s })}>
                Edit
              </Button>
              {(s.status === 'approved' || s.status === 'blocked') && (
              <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'pin', s })}>
                Reset PIN
              </Button>
              )}
            </>
          )}
          {!s.isDeleted && s.status === 'approved' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setDialog({
                  kind: 'status',
                  s,
                  to: 'blocked',
                  title: `Block ${s.name}?`,
                  text: 'They will be logged out on their next request and cannot check in until unblocked.',
                  label: 'Block student',
                })
              }
            >
              Block
            </Button>
          )}
          {!s.isDeleted && s.status === 'blocked' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setDialog({
                  kind: 'status',
                  s,
                  to: 'approved',
                  title: `Unblock ${s.name}?`,
                  text: 'They will be able to log in and check in again.',
                  label: 'Unblock',
                })
              }
            >
              Unblock
            </Button>
          )}
          {!s.isDeleted && (
            <Button
              size="sm"
              variant="dangerOutline"
              onClick={() => setDialog({ kind: 'delete', s })}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="glass-b flex flex-col gap-3 rounded-2xl p-4 md:flex-row md:items-center md:justify-between">
        <div role="tablist" aria-label="Student status" className="glass-c flex gap-1 overflow-x-auto rounded-[10px] p-1 md:order-2">
          {TABS.map((t) => {
            const on = t.key === tab;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.key)}
                className={cn(
                  'flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm transition-all',
                  on ? 'bg-white/90 font-semibold text-oxford shadow-sm' : 'text-muted hover:bg-white/60 hover:text-ink'
                )}
              >
                {t.label}
                <span className="rounded-full bg-[#efe8da] px-2 py-px text-xs font-semibold text-ink">{counts.data?.[t.key] ?? '–'}</span>
              </button>
            );
          })}
        </div>
        <SearchBox value={search} onChange={setSearch} placeholder="Search name or phone" label="Search students" className="w-full md:order-1 md:w-75" />
        <Button
          icon={<UserPlus size={16} />}
          className="w-full md:order-3 md:ml-auto md:w-auto"
          onClick={() => setAddOpen(true)}
        >
          Add student
        </Button>
      </div>

      {list.loading && !list.data ? (
        <div className="glass-b flex flex-col gap-2 rounded-2xl p-4" aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : list.error && !list.data ? (
        <ErrorState title="Couldn't load students" message={list.error} onRetry={list.reload} />
      ) : list.data && list.data.rows.length === 0 ? (
        <div className="glass-b rounded-2xl">
          <EmptyState
            icon={<Users size={26} strokeWidth={1.7} />}
            title={q ? 'No matching students' : `No ${tab} students`}
            text={q ? 'Try a different name or phone number.' : tab === 'pending' ? 'New registrations will appear here for approval.' : undefined}
          />
        </div>
      ) : (
        list.data && (
          <DataTable
            columns={columns}
            rows={list.data.rows}
            rowKey={(s) => s._id}
            footer={<Pagination p={list.data.pagination} onPage={setPage} />}
          />
        )
      )}

      <StudentDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        onDone={changed}
        onPinReady={(pin, student) => setSharePin({ name: student.name, phone: student.phone, pin })}
        dispatch={dispatch}
      />
      <AddStudentModal open={addOpen} busy={adding} onClose={() => setAddOpen(false)} onSubmit={addStudent} />
      <SharePinModal pin={sharePin} onClose={() => setSharePin(null)} dispatch={dispatch} />
    </div>
  );
}

function StudentDialogs({
  dialog,
  onClose,
  onDone,
  onPinReady,
  dispatch,
}: {
  dialog: Dialog;
  onClose: () => void;
  onDone: () => void;
  onPinReady: (pin: string, student: Student) => void;
  dispatch: ReturnType<typeof useAppDispatch>;
}) {
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      dispatch(showToast('success', success));
      onDone();
      onClose();
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
    } finally {
      setBusy(false);
    }
  };

  const resetPin = async () => {
    if (dialog?.kind !== 'pin') return;
    const student = dialog.s;
    setBusy(true);
    try {
      const res = await post<{ message: string; pin: string }>(ENDPOINTS.admin.resetStudentPin(student._id));
      dispatch(showToast('success', res.data.message));
      onDone();
      onClose();
      onPinReady(res.data.pin, student);
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ApproveModal
        open={dialog?.kind === 'approve'}
        student={dialog?.kind === 'approve' ? dialog.s : null}
        busy={busy}
        onClose={onClose}
        onSubmit={(fee) => {
          const s = (dialog as { s: Student }).s;
          return run(() => patch(ENDPOINTS.admin.updateStudentStatus(s._id), { status: 'approved', monthlyFee: fee }), 'Student approved');
        }}
      />
      <RestoreStudentModal
        open={dialog?.kind === 'restore'}
        student={dialog?.kind === 'restore' ? dialog.s : null}
        busy={busy}
        onClose={onClose}
        onSubmit={(assignment) => {
          const s = (dialog as { s: Student }).s;
          return run(
            () => patch(ENDPOINTS.admin.restoreStudent(s._id), assignment),
            'Student restored as pending'
          );
        }}
      />
      <EditModal
        open={dialog?.kind === 'edit'}
        student={dialog?.kind === 'edit' ? dialog.s : null}
        busy={busy}
        onClose={onClose}
        onSubmit={(body) => {
          const s = (dialog as { s: Student }).s;
          return run(() => patch(ENDPOINTS.admin.studentById(s._id), body), 'Student updated');
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'pin'}
        title={dialog?.kind === 'pin' ? `Generate a new PIN for ${dialog.s.name}?` : ''}
        description="A random six-digit PIN will be generated, and the account will be unlocked. The PIN will be shown once so you can share it with the student."
        confirmLabel="Generate PIN"
        tone="primary"
        loading={busy}
        onCancel={onClose}
        onConfirm={() => void resetPin()}
      />
      <ConfirmDialog
        open={dialog?.kind === 'status'}
        title={dialog?.kind === 'status' ? dialog.title : ''}
        description={dialog?.kind === 'status' ? dialog.text : undefined}
        confirmLabel={dialog?.kind === 'status' ? dialog.label : ''}
        tone={dialog?.kind === 'status' && dialog.to === 'approved' ? 'primary' : 'danger'}
        loading={busy}
        onCancel={onClose}
        onConfirm={() => {
          if (dialog?.kind !== 'status') return;
          const d = dialog;
          void run(
            () => patch(ENDPOINTS.admin.updateStudentStatus(d.s._id), { status: d.to }),
            d.to === 'blocked' ? 'Student blocked' : d.to === 'rejected' ? 'Student rejected' : 'Student unblocked'
          );
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        title={dialog?.kind === 'delete' ? `Delete ${dialog.s.name}?` : ''}
        description="They will not be able to log in. Their attendance and fee history is kept."
        confirmLabel="Delete student"
        tone="danger"
        loading={busy}
        onCancel={onClose}
        onConfirm={() => {
          if (dialog?.kind !== 'delete') return;
          const d = dialog;
          void run(
            () => del(ENDPOINTS.admin.studentById(d.s._id)),
            'Student deleted successfully'
          );
        }}
      />
    </>
  );
}

function ApproveModal({
  open,
  student,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  student: Student | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (fee: number) => void;
}) {
  const [fee, setFee] = useState('1000');
  useEffect(() => {
    if (open && student) setFee(String(student.monthlyFee || 1000));
  }, [open, student]);

  const n = Number(fee);
  const valid = fee !== '' && Number.isFinite(n) && n >= 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) onSubmit(n);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={busy}
      kicker="Approve student"
      title={student?.name ?? ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => valid && onSubmit(n)} loading={busy} disabled={!valid}>
            Approve student
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="tnum -mt-2 text-sm text-muted">
          +91 {student && formatPhone(student.phone)} · Registered {student && dateLabel(student.createdAt)}
        </p>
        <Input
          label="Monthly fee"
          prefix="₹"
          value={fee}
          onChange={(v) => setFee(v.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          helper="Fees are generated on the 1st of every month."
          data-autofocus
        />
      </form>
    </Modal>
  );
}

function RestoreStudentModal({
  open,
  student,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  student: Student | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (assignment: { seatNumber: number; shiftHours: ShiftHours }) => void;
}) {
  const [seatNumber, setSeatNumber] = useState<number | ''>('');
  const [shiftHours, setShiftHours] = useState<ShiftHours>(4);
  const [seats, setSeats] = useState<number[]>([]);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [seatError, setSeatError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open || !student) return;
    let active = true;
    setSeatNumber('');
    setShiftHours(4);
    setLoadingSeats(true);
    setSeatError(null);
    get<number[]>(ENDPOINTS.admin.availableStudentSeats(student._id))
      .then((response) => {
        if (active) setSeats(response.data);
      })
      .catch((error: unknown) => {
        if (active) setSeatError(errMsg(error));
      })
      .finally(() => {
        if (active) setLoadingSeats(false);
      });
    return () => {
      active = false;
    };
  }, [open, student, retry]);

  const submit = () => {
    if (seatNumber === '') return;
    onSubmit({ seatNumber, shiftHours });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={busy}
      kicker="Restore student"
      title={student?.name ?? ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={seatNumber === '' || loadingSeats || !!seatError}>
            Restore as pending
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Choose a currently available seat and shift. The student will return as pending for admin approval.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Assigned seat
            <select
              value={seatNumber}
              onChange={(event) => setSeatNumber(event.target.value ? Number(event.target.value) : '')}
              disabled={loadingSeats || !!seatError || seats.length === 0}
              className="h-11 rounded-xl border border-line-strong bg-white px-3 text-sm text-ink disabled:opacity-60"
            >
              <option value="">{loadingSeats ? 'Loading seats…' : 'Select a seat'}</option>
              {seats.map((number) => <option key={number} value={number}>Seat {number}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Study shift
            <select
              value={shiftHours}
              onChange={(event) => setShiftHours(Number(event.target.value) as ShiftHours)}
              className="h-11 rounded-xl border border-line-strong bg-white px-3 text-sm text-ink"
            >
              <option value={4}>4 hours</option>
              <option value={12}>12 hours</option>
              <option value={24}>24 hours</option>
            </select>
          </label>
        </div>
        {seatError && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>{seatError}</span>
            <Button size="sm" variant="secondary" onClick={() => setRetry((value) => value + 1)}>Retry</Button>
          </div>
        )}
        {!loadingSeats && !seatError && seats.length === 0 && (
          <p className="text-sm text-muted">No seats are currently available.</p>
        )}
      </div>
    </Modal>
  );
}

function EditModal({
  open,
  student,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  student: Student | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [fee, setFee] = useState('');
  const [seatNumber, setSeatNumber] = useState<number | ''>('');
  const [shiftHours, setShiftHours] = useState<ShiftHours>(4);
  const [seats, setSeats] = useState<number[]>([]);
  const [seatsLoading, setSeatsLoading] = useState(false);
  const [seatsError, setSeatsError] = useState<string | null>(null);
  const [seatRetry, setSeatRetry] = useState(0);
  const [wa, setWa] = useState(true);
  const [sms, setSms] = useState(true);

  useEffect(() => {
    if (open && student) {
      setName(student.name);
      setPhone(student.phone);
      setEmail(student.email ?? '');
      setFee(String(student.monthlyFee));
      setSeatNumber(student.seatNumber ?? '');
      setShiftHours(student.shiftHours ?? 4);
      setWa(student.whatsappOptIn);
      setSms(student.smsOptIn);
    }
  }, [open, student]);

  useEffect(() => {
    if (!open || !student) return;
    let active = true;
    setSeatsLoading(true);
    setSeatsError(null);
    get<number[]>(ENDPOINTS.admin.availableStudentSeats(student._id))
      .then((response) => {
        if (active) setSeats(response.data);
      })
      .catch((error: unknown) => {
        if (active) setSeatsError(errMsg(error));
      })
      .finally(() => {
        if (active) setSeatsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, student, seatRetry]);

  const valid = name.trim().length >= 2
    && /^\d{10}$/.test(phone)
    && (email.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    && fee !== ''
    && Number.isFinite(Number(fee))
    && Number(fee) >= 0
    && seatNumber !== '';
  const submit = () => {
    if (!valid) return;
    onSubmit({
      name: name.trim(),
      phone,
      email: email.trim(),
      monthlyFee: Number(fee),
      seatNumber,
      shiftHours,
      whatsappOptIn: wa,
      smsOptIn: sms,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={busy}
      kicker="Edit student"
      title={student?.name ?? ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!valid || seatsLoading || !!seatsError || seats.length === 0}
            onClick={submit}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label="Full name" value={name} onChange={setName} maxLength={100} data-autofocus />
        <Input
          label="Phone number"
          prefix="+91"
          value={phone}
          onChange={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
          inputMode="numeric"
          error={phone.length > 0 && phone.length !== 10 ? 'Enter a 10-digit number' : null}
        />
        <Input
          label="Email address (optional)"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          error={email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'Enter a valid email address' : null}
        />
        <Input label="Monthly fee" prefix="₹" value={fee} onChange={(v) => setFee(v.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" />
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Assigned seat
            <select
              value={seatNumber}
              onChange={(event) => setSeatNumber(event.target.value ? Number(event.target.value) : '')}
              disabled={seatsLoading || !!seatsError || seats.length === 0}
              className="h-11 rounded-xl border border-line-strong bg-white px-3 text-sm text-ink disabled:opacity-60"
            >
              <option value="">{seatsLoading ? 'Loading seats…' : 'Select a seat'}</option>
              {seats.map((number) => <option key={number} value={number}>Seat {number}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Study shift
            <select
              value={shiftHours}
              onChange={(event) => setShiftHours(Number(event.target.value) as ShiftHours)}
              className="h-11 rounded-xl border border-line-strong bg-white px-3 text-sm text-ink"
            >
              <option value={4}>4 hours</option>
              <option value={12}>12 hours</option>
              <option value={24}>24 hours</option>
            </select>
          </label>
        </div>
        {seatsError ? (
          <p role="alert" className="m-0 text-sm text-red-700">
            Could not load available seats: {seatsError}{' '}
            <button type="button" onClick={() => setSeatRetry((value) => value + 1)} className="underline">Retry</button>
          </p>
        ) : !seatsLoading && seats.length === 0 ? (
          <p role="status" className="m-0 text-sm text-muted">No seats are available to assign.</p>
        ) : null}
        <div>
          <Checkbox checked={wa} onChange={setWa} label="WhatsApp alerts" />
          <Checkbox checked={sms} onChange={setSms} label="SMS alerts" />
        </div>
      </div>
    </Modal>
  );
}

function AddStudentModal({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (student: NewStudent) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [fee, setFee] = useState('');
  const [pin, setPin] = useState('');
  const [seatNumber, setSeatNumber] = useState<number | ''>('');
  const [shiftHours, setShiftHours] = useState<ShiftHours>(4);
  const [seats, setSeats] = useState<number[]>([]);
  const [seatsLoading, setSeatsLoading] = useState(false);
  const [seatsError, setSeatsError] = useState<string | null>(null);
  const [seatsReload, setSeatsReload] = useState(0);
  const [whatsappOptIn, setWhatsappOptIn] = useState(true);
  const [smsOptIn, setSmsOptIn] = useState(true);

  useEffect(() => {
    if (open) {
      setName('');
      setPhone('');
      setFee('');
      setPin('');
      setSeatNumber('');
      setShiftHours(4);
      setWhatsappOptIn(true);
      setSmsOptIn(true);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setSeatsLoading(true);
    setSeatsError(null);
    get<number[]>(ENDPOINTS.auth.availableSeats)
      .then((res) => {
        if (active) setSeats(res.data);
      })
      .catch((error: unknown) => {
        if (active) setSeatsError(errMsg(error));
      })
      .finally(() => {
        if (active) setSeatsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, seatsReload]);

  const feeAmount = Number(fee);
  const valid = name.trim().length >= 2
    && name.trim().length <= 100
    && /^\d{10}$/.test(phone)
    && fee !== ''
    && Number.isFinite(feeAmount)
    && feeAmount >= 0
    && seatNumber !== ''
    && (pin === '' || /^\d{6}$/.test(pin));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onSubmit({
      name: name.trim(),
      phone,
      ...(pin && { pin }),
      seatNumber,
      shiftHours,
      monthlyFee: feeAmount,
      whatsappOptIn,
      smsOptIn,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={busy}
      kicker="New library member"
      title="Add student"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="add-student-form" loading={busy} disabled={!valid}>
            Add student
          </Button>
        </>
      }
    >
      <form id="add-student-form" onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-muted">
          The student will be approved immediately. An optional PIN can be set now; otherwise a secure six-digit PIN will be generated.
        </p>
        <Input
          label="Full name"
          value={name}
          onChange={setName}
          maxLength={100}
          error={name.length > 0 && name.trim().length < 2 ? 'Enter at least 2 characters' : null}
          data-autofocus
        />
        <Input
          label="Phone number"
          prefix="+91"
          value={phone}
          onChange={(value) => setPhone(value.replace(/\D/g, '').slice(0, 10))}
          inputMode="numeric"
          autoComplete="tel-national"
          error={phone.length > 0 && phone.length !== 10 ? 'Enter a 10-digit mobile number' : null}
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Assigned seat
            <select
              value={seatNumber}
              onChange={(event) => setSeatNumber(event.target.value ? Number(event.target.value) : '')}
              disabled={seatsLoading || !!seatsError || seats.length === 0}
              className="h-11 rounded-xl border border-line-strong bg-white px-3 text-sm text-ink disabled:opacity-60"
            >
              <option value="">{seatsLoading ? 'Loading seats…' : 'Select a seat'}</option>
              {seats.map((number) => <option key={number} value={number}>Seat {number}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Study shift
            <select
              value={shiftHours}
              onChange={(event) => setShiftHours(Number(event.target.value) as ShiftHours)}
              className="h-11 rounded-xl border border-line-strong bg-white px-3 text-sm text-ink"
            >
              <option value={4}>4 hours</option>
              <option value={12}>12 hours</option>
              <option value={24}>24 hours</option>
            </select>
          </label>
        </div>
        {seatsError ? (
          <p role="alert" className="m-0 text-sm text-red-700">
            Could not load seats: {seatsError}{' '}
            <button type="button" onClick={() => setSeatsReload((value) => value + 1)} className="underline">Retry</button>
          </p>
        ) : !seatsLoading && seats.length === 0 ? (
          <p role="status" className="m-0 text-sm text-muted">No seats are available. Free a seat before adding another student.</p>
        ) : null}
        <Input
          label="Monthly fee"
          prefix="₹"
          value={fee}
          onChange={(value) => setFee(value.replace(/\D/g, '').slice(0, 7))}
          inputMode="numeric"
          error={fee !== '' && (!Number.isFinite(feeAmount) || feeAmount < 0) ? 'Enter a valid fee' : null}
          helper="Enter 0 if no monthly fee applies."
        />
        <PinInput label="PIN (optional)" value={pin} onChange={setPin} compact />
        <div className="glass-c rounded-xl px-3">
          <Checkbox checked={whatsappOptIn} onChange={setWhatsappOptIn} label="WhatsApp alerts" />
          <Checkbox checked={smsOptIn} onChange={setSmsOptIn} label="SMS alerts" />
        </div>
      </form>
    </Modal>
  );
}

function SharePinModal({
  pin,
  onClose,
  dispatch,
}: {
  pin: SharePin | null;
  onClose: () => void;
  dispatch: ReturnType<typeof useAppDispatch>;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (pin) setCopied(false);
  }, [pin]);

  const copyPin = async () => {
    if (!pin) return;
    try {
      await navigator.clipboard.writeText(pin.pin);
      setCopied(true);
      dispatch(showToast('success', 'PIN copied to clipboard.'));
    } catch {
      dispatch(showToast('error', 'Could not copy the PIN. Please select and copy it manually.'));
    }
  };

  return (
    <Modal
      open={!!pin}
      onClose={onClose}
      kicker="Share securely"
      title="Share this PIN"
      width="sm:max-w-[420px]"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p className="text-sm text-muted">
        {pin?.name} · +91 {pin && formatPhone(pin.phone)}
      </p>
      <div className="glass-b flex flex-col items-center gap-3 rounded-2xl p-5">
        <span className="tnum font-mono text-4xl font-bold tracking-[.28em] text-oxford" aria-label="Student PIN">
          {pin?.pin}
        </span>
        <Button variant="outline" size="sm" icon={copied ? <Check size={16} /> : <Copy size={16} />} onClick={() => void copyPin()}>
          {copied ? 'Copied' : 'Copy PIN'}
        </Button>
      </div>
      <p className="text-center text-sm font-semibold text-gold-dark">This PIN is shown only once.</p>
    </Modal>
  );
}
