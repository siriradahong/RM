// Base appointments are singular. Delegations are separate, dated grants.
export function assignmentReviewRequired(user) {
  return (
    user.roles.length !== 1 ||
    (user.scopes || []).length > 1 ||
    (user.work_scopes || []).length > 1
  );
}
