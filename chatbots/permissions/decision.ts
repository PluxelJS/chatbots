export const enum Decision {
	Deny = -1,
	Unset = 0,
	Allow = 1,
}

export const can = (d: Decision): boolean => d === Decision.Allow

