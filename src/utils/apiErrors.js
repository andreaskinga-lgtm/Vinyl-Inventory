export function isAdministratorSessionError(status, body) {
  return (
    status === 401 &&
    body?.error === "Administrator authentication required"
  );
}
