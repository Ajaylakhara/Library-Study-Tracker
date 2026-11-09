import type { ReactNode } from 'react';
import type { Student } from '../types';
import { DataTable, type Column } from './DataTable';

export interface StudentTableProps {
  students: Student[];
  columns: Column<Student>[];
  footer?: ReactNode;
}

export function StudentTable({ students, columns, footer }: StudentTableProps) {
  return (
    <DataTable<Student>
      rows={students}
      columns={columns}
      rowKey={(s) => s._id}
      footer={footer}
    />
  );
}
