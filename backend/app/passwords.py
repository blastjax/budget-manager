"""Password hashing for app-managed user accounts.

Uses Argon2id (via ``argon2-cffi``) — the winner of the Password Hashing
Competition and OWASP's top recommendation for storing passwords, ahead of
bcrypt/scrypt/PBKDF2. ``PasswordHasher()``'s defaults already match OWASP's
recommended parameters (time_cost=3, memory_cost=64 MiB, parallelism=4,
salt_len=16, hash_len=32, type=Argon2id), so nothing here overrides them.

Each hash is salted and self-describing (algorithm + parameters + salt are
encoded in the stored string), so verification and future rehashing don't
need any side-channel about how a given row was hashed.
"""

from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerifyMismatchError

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    """Return a salted Argon2id hash string, safe to store as-is."""
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """True if ``password`` matches ``password_hash``.

    Not wired into any login flow yet (see app/routers/auth.py for the
    current OTP-only session auth) — kept here so the user table this
    supports is ready for that once it's built.
    """
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHash):
        return False
