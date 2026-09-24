/**
 * The permission catalogue (§11).
 *
 * Permissions are rows in the database, but the keys live here so the
 * TypeScript side can name them without typos, and so the seed has one place
 * to read the whole set from. Adding a permission means adding a line here and
 * re-running the seed — no migration, because the table is data.
 */
export const PERMISSIONS = {
  // catalogue
  'book.read':        { group: 'catalog', description: 'See books, including drafts' },
  'book.write':       { group: 'catalog', description: 'Create and edit books' },
  'book.publish':     { group: 'catalog', description: 'Publish and unpublish books' },
  'book.delete':      { group: 'catalog', description: 'Delete books' },
  'category.write':   { group: 'catalog', description: 'Manage categories and tags' },
  'inventory.write':  { group: 'catalog', description: 'Adjust stock' },

  // orders
  'order.read':       { group: 'orders', description: 'See regular orders' },
  'order.write':      { group: 'orders', description: 'Change order status and notes' },
  'order.address.read': { group: 'orders', description: 'See shipping addresses on orders' },
  'gift.read':        { group: 'orders', description: 'See gift orders' },
  'gift.process':     { group: 'orders', description: 'Run the gift workflow and hold recipient contact data' },

  // journal
  'article.read':     { group: 'journal', description: 'See articles, including drafts' },
  'article.write':    { group: 'journal', description: 'Create and edit articles' },
  'article.publish':  { group: 'journal', description: 'Publish, schedule and unpublish articles' },
  'article.delete':   { group: 'journal', description: 'Delete articles' },

  // media
  'media.read':       { group: 'media', description: 'Browse the media library' },
  'media.write':      { group: 'media', description: 'Upload and edit media' },
  'media.delete':     { group: 'media', description: 'Delete media' },

  // people
  'user.read':        { group: 'people', description: 'See user accounts' },
  'user.write':       { group: 'people', description: 'Edit user accounts' },
  'role.write':       { group: 'people', description: 'Grant and revoke roles and permissions' },

  // presentation
  'theme.read':       { group: 'themes', description: 'See themes and drafts' },
  'theme.write':      { group: 'themes', description: 'Edit theme drafts' },
  'theme.publish':    { group: 'themes', description: 'Publish a theme to the live site' },

  // system
  'settings.write':   { group: 'system', description: 'Change site settings' },
  'audit.read':       { group: 'system', description: 'Read the audit log' }
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

/** What each seeded role starts with. SUPER_ADMIN is granted everything at
 *  seed time rather than listed, so a new permission is never accidentally
 *  withheld from the one role that must always have it. */
export const ROLE_PERMISSIONS: Record<string, PermissionKey[] | '*'> = {
  SUPER_ADMIN: '*',

  MANAGER: [
    'order.read', 'order.write', 'order.address.read',
    'gift.read', 'gift.process',
    'book.read', 'inventory.write',
    'user.read',
    'media.read'
  ],

  CATALOG_MANAGER: [
    'book.read', 'book.write', 'book.publish', 'book.delete',
    'category.write', 'inventory.write',
    'media.read', 'media.write'
  ],

  CONTENT_EDITOR: [
    'article.read', 'article.write', 'article.publish', 'article.delete',
    'media.read', 'media.write',
    'book.read'
  ],

  CUSTOMER: []
};

export const ROLE_NAMES: Record<string, { name: string; description: string }> = {
  SUPER_ADMIN:     { name: 'Super admin',     description: 'Everything, including roles, themes and system settings' },
  MANAGER:         { name: 'Manager',         description: 'Orders, gift workflow and shipping' },
  CATALOG_MANAGER: { name: 'Catalogue manager', description: 'Books, categories, prices and stock' },
  CONTENT_EDITOR:  { name: 'Content editor',  description: 'Journal articles and media' },
  CUSTOMER:        { name: 'Customer',        description: 'A shop account with no staff access' }
};
