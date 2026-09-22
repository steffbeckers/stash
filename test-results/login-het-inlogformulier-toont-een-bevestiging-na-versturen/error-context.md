# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: login.spec.ts >> het inlogformulier toont een bevestiging na versturen
- Location: e2e\login.spec.ts:8:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/inbox/i)
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText(/inbox/i) with timeout 5000ms
  - waiting for getByText(/inbox/i)

```

```yaml
- status
- heading "Sign in" [level=1]
- text: Email address
- textbox "Email address"
- button "Send me a link"
- region "Notifications (F8)":
  - list
- img
- button "Toggle Nuxt DevTools":
  - img
- text: 77 ms
- button "Toggle Component Inspector":
  - img
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | 
  3  | test('een afgeschermde pagina stuurt je naar inloggen', async ({ page }) => {
  4  |   await page.goto('/')
  5  |   await expect(page).toHaveURL(/\/login/)
  6  | })
  7  | 
  8  | test('het inlogformulier toont een bevestiging na versturen', async ({ page }) => {
  9  |   await page.goto('/login')
  10 |   await page.getByLabel(/email/i).fill('test@example.com')
  11 |   await page.getByRole('button', { name: /link/i }).click()
> 12 |   await expect(page.getByText(/inbox/i)).toBeVisible()
     |                                          ^ Error: expect(locator).toBeVisible() failed
  13 | })
  14 | 
```