import {
  DEFAULT_PENDING_EMPLOYEE_COLOR,
  DEFAULT_PENDING_EMPLOYEE_USERNAME,
  getPendingAssignmentEmployeeUsername,
  isPendingAssignmentEmployee,
  isPendingAssignmentEmployeeUsername,
} from '../../shared/pending-assignment';

export {
  DEFAULT_PENDING_EMPLOYEE_COLOR,
  DEFAULT_PENDING_EMPLOYEE_USERNAME,
  getPendingAssignmentEmployeeUsername,
  isPendingAssignmentEmployee,
  isPendingAssignmentEmployeeUsername,
};

export function getPendingAssignmentRuntime() {
  const browserOverride = typeof window !== 'undefined'
    ? window.localStorage.getItem('PENDING_EMPLOYEE_USERNAME') ?? undefined
    : undefined;

  return {
    env: {
      PENDING_EMPLOYEE_USERNAME: browserOverride ?? import.meta.env.VITE_PENDING_EMPLOYEE_USERNAME ?? import.meta.env.PENDING_EMPLOYEE_USERNAME,
    },
  };
}
