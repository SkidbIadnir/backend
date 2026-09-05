import { TasteepUser } from '../entities/tasteep-user.entity';

/** Wire shape of `lib/models/auth_user.dart` — snake_case, no envelope. */
export interface AuthUserJson {
  id: string;
  display_name: string;
  provider: TasteepUser['provider'];
  email: string | null;
  token: string | null;
}

export function toAuthUserJson(
  user: TasteepUser,
  token: string | null = null,
): AuthUserJson {
  return {
    id: user.id,
    display_name: user.displayName,
    provider: user.provider,
    email: user.email,
    token,
  };
}
