/** Home dashboard cards the user can show/hide (Settings -> Appearance). */
export const HOME_WIDGETS: Array<{ id: string; label: string }> = [
  { id: 'clock', label: 'Clock and date' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'frequent', label: 'Most accessed' },
  { id: 'focus', label: 'Focus stage (current item)' },
  { id: 'continuum', label: 'Home rail (recent files)' },
  { id: 'places', label: 'Places and drives' },
  { id: 'trail', label: 'Session trail' },
];
export const DEFAULT_HOME_WIDGETS = HOME_WIDGETS.map(w => w.id);
