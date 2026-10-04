/** Pantallas de plantilla (P2-P4) y utilidades. El servicio llega siempre por props. */
export { SquadScreen, type SquadScreenProps } from './SquadScreen';
export { PlayerFormScreen, type PlayerFormScreenProps } from './PlayerFormScreen';
export { TeamScreen, type TeamScreenProps } from './TeamScreen';
export { PlayerAvatar, AVATAR_SIZE, type PlayerAvatarProps } from './PlayerAvatar';
export { pickPlayerPhoto, PHOTO_SIZE, GALLERY_PERMISSION_DENIED } from './photoPicker';
export { useSquadScreenState, errorMessage } from './useSquadState';
export {
  BigButton,
  Chip,
  ChipRow,
  FormField,
  IssueText,
  LabelledRow,
  PRIMARY_HEIGHT,
  SECONDARY_HEIGHT,
  type BigButtonProps,
  type ChipProps,
  type FormFieldProps,
} from './controls';
