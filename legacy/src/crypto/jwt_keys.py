"""JWT signing keysets (RS256 today; type kept pluggable for later algs)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey
from jwt.algorithms import RSAAlgorithm


@dataclass(frozen=True)
class JwtKeySet:
    """Signing material and public JWKS for one algorithm/key id."""

    private_key: RSAPrivateKey
    kid: str
    alg: str = "RS256"

    @classmethod
    def from_pem(cls, pem: str, kid: str) -> JwtKeySet:
        """Load an RSA private key from PEM and bind it to ``kid``."""
        key = serialization.load_pem_private_key(pem.encode("utf-8"), password=None)
        if not isinstance(key, RSAPrivateKey):
            msg = "TOKEN_SIGNING_KEY_PATH must point to an RSA private key PEM"
            raise TypeError(msg)
        return cls(private_key=key, kid=kid, alg="RS256")

    def public_jwks(self) -> dict[str, Any]:
        """Return a JWKS document containing the public RSA key."""
        public_key = self.private_key.public_key()
        jwk = RSAAlgorithm.to_jwk(public_key, as_dict=True)
        jwk.update({"kid": self.kid, "alg": self.alg, "use": "sig"})
        return {"keys": [jwk]}
