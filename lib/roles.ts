export type Role = 'admin' | 'coach' | 'athlete';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Amministratore',
  coach: 'Coach',
  athlete: 'Atleta',
};
