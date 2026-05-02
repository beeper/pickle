export class User {
  readonly userId: string;
  displayName: string | undefined;
  avatarUrl: string | undefined;

  constructor(userId: string) {
    this.userId = userId;
  }
}
