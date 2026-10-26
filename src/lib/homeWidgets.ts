/** Home dashboard modules the user can show/hide (Settings -> Appearance,
 *  and the dashboard's own + gallery). Built-in widgets render Home's own
 *  sections; plugins pull live data from a service (Homarr-style). */
export type HomeModuleDef = {
  id: string;
  label: string;
  description: string;
  /** Grid columns the module occupies on the dashboard (4-column grid). */
  span: 1 | 2 | 3 | 4;
  kind: 'widget' | 'plugin';
};

export const HOME_WIDGETS: HomeModuleDef[] = [
  { id: 'clock', label: 'Clock and date', description: 'Live clock and date in the Home header.', span: 1, kind: 'widget' },
  { id: 'workspaces', label: 'Workspaces', description: 'Launch pads for Spatial Canvas and Automation.', span: 4, kind: 'widget' },
  { id: 'focus', label: 'Focus stage (current item)', description: 'The item you are focused on right now, with quick actions.', span: 2, kind: 'widget' },
  { id: 'frequent', label: 'Most accessed', description: 'Your most opened files and folders, by opens and navigation heat.', span: 4, kind: 'widget' },
  { id: 'continuum', label: 'Home rail (recent files)', description: 'A rail of recent images, video, audio and documents from your indexed folders.', span: 4, kind: 'widget' },
  { id: 'places', label: 'Places and drives', description: 'Quick places and your drives with free space.', span: 2, kind: 'widget' },
  { id: 'trail', label: 'Session trail', description: 'Where you have been this session — jump straight back.', span: 2, kind: 'widget' },
  { id: 'githubFeed', label: 'GitHub feed', description: 'Live GitHub activity — pushes, pull requests, releases and stars for your account.', span: 2, kind: 'plugin' },
];

export const DEFAULT_HOME_WIDGETS = HOME_WIDGETS.filter(w => w.id !== 'githubFeed').map(w => w.id);

/** Default dashboard order for the deck modules (clock lives in the header). */
export const DEFAULT_HOME_MODULE_ORDER = ['workspaces', 'focus', 'frequent', 'continuum', 'places', 'githubFeed', 'trail'];

export function homeModuleDef(id: string): HomeModuleDef | undefined {
  return HOME_WIDGETS.find(w => w.id === id);
}
