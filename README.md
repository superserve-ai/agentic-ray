# Platform Billing changes

Copy these files over the matching paths in the superserve repository.

Implemented:

- `/platform/billing` internal page
- staff + `platform:billing:read` authorization
- current-period totals across all customers
- customer/team-name search
- compact usage breakdown beneath each subtotal
- credits applied, net due, and credits remaining
- isolated per-customer API failures
- focused action and component tests

Validation note: Bun and repository dependencies were not available in the execution environment, so lint, typecheck, and tests were not run here.
