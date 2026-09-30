import type { User } from "./types.js";

type Account = User;
import { Profile } from "./profiles.js";
type ProfileAccount = Profile;

import { User as RuntimeUser } from "./models.js";

function getUser(): User {
  return RuntimeUser;
}
