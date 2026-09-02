import { SettingsPanel } from '@/components/settings/SettingsPanel'

// Admin/Executive/Reviewer settings — rendered inside the dashboard shell
// (sidebar + navbar) so users can navigate away without the browser back button.
export default function SettingsPage() {
  return <SettingsPanel />
}
