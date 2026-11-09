/**
 * Central registry of all backend endpoints for Library Study Tracker.
 */

export const ENDPOINTS = {
  auth: {
    login: '/auth/login',
    register: '/auth/register',
    availableSeats: '/auth/seats/available',
    logout: '/auth/logout',
    me: '/auth/me',
  },
  student: {
    status: '/me/status',
    availableSeats: '/me/seats/available',
    checkIn: '/me/checkin',
    checkOut: '/me/checkout',
    attendance: '/me/attendance',
    summary: '/me/summary',
    fees: '/me/fees',
    profile: '/me/profile',
    changePin: '/me/change-pin',
  },
  admin: {
    liveSeats: '/admin/seats/live',
    students: '/admin/students',
    createStudent: '/admin/students',
    studentById: (id: string) => `/admin/students/${id}`,
    availableStudentSeats: (id: string) => `/admin/students/${id}/available-seats`,
    updateStudentStatus: (id: string) => `/admin/students/${id}/status`,
    resetStudentPin: (id: string) => `/admin/students/${id}/reset-pin`,
    studentAttendance: (id: string) => `/admin/students/${id}/attendance`,
    sessions: '/admin/sessions',
    forceCheckout: (id: string) => `/admin/sessions/${id}/force-checkout`,
    fees: '/admin/fees',
    markFeePaid: (id: string) => `/admin/fees/${id}/pay`,
    generateFees: '/admin/fees/generate',
    reportSummary: '/admin/reports/summary',
    reportStudents: '/admin/reports/students',
    exportAttendanceCsv: '/admin/export/attendance.csv',
    notifications: '/admin/notifications',
    failedNotifications: '/admin/notifications/failed',
    // Temporarily disabled with admin overtime follow-up alerts.
    // needsActionNotifications: '/admin/notifications/needs-action',
    unreadNotificationCount: '/admin/notifications/unread-count',
    readAllNotifications: '/admin/notifications/read-all',
    // contactedNotification: (id: string) => `/admin/notifications/${id}/contacted`,
    readNotification: (id: string) => `/admin/notifications/${id}/read`,
  },
} as const;
