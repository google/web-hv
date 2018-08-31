// Copyright 2018 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

var AdbKey = (function () {
    const ADB_WEB_CRYPTO_ALGORITHM = {
        name: 'RSASSA-PKCS1-v1_5',
        hash: {
            name: 'SHA-1'
        },
    };

    const WORD_SIZE = 4;
    const MODULUS_SIZE_BITS = 2048;
    const MODULUS_SIZE = MODULUS_SIZE_BITS / 8;
    const MODULUS_SIZE_WORDS = MODULUS_SIZE / WORD_SIZE;
    const PUBKEY_ENCODED_SIZE = 3 * WORD_SIZE + 2 * MODULUS_SIZE;

    const PUBLIC_EXPONENT = new Uint8Array([0x01, 0x00, 0x01]);
    const ADB_WEB_CRYPTO_EXPORTABLE = true;
    const ADB_WEB_CRYPTO_OPERATIONS = ['sign'];

    const SIGNING_ASN1_PREFIX = [
        0x00, 0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2B, 0x0E, 0x03, 0x02, 0x1A, 0x05,
        0x00, 0x04, 0x14
    ];

    const R32 = BigInteger.ONE.shiftLeft(32); // 1 << 32

    function bigIntToFixedByteArray(bn, size) {
        // big-endian byte array
        const bytes = bn.toByteArray();

        // Pad zeros if array isn't big enough
        while (bytes.length < size) {
            bytes.unshift(0);
        }

        // Remove extra zeros if array is too big
        while (bytes.length > size) {
            if (bytes[0] !== 0) {
                throw new Error('BigInteger value exceeds available size');
            }
            bytes.shift();
        }

        return bytes;
    }

    function encodeAndroidPublicKeyBytes(key) {
        const n0inv = R32.subtract(key.n.modInverse(R32)).intValue();
        const r = BigInteger.ONE.shiftLeft(1).pow(MODULUS_SIZE_BITS);
        const rr = r.multiply(r).mod(key.n);

        const buffer = new ArrayBuffer(PUBKEY_ENCODED_SIZE);
        var dv = new DataView(buffer);
        dv.setUint32(0, MODULUS_SIZE_WORDS, true);
        dv.setUint32(WORD_SIZE, n0inv, true);
        new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength / Uint8Array.BYTES_PER_ELEMENT).set(bigIntToFixedByteArray(key.n, MODULUS_SIZE).reverse(), 2 * WORD_SIZE);
        new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength / Uint8Array.BYTES_PER_ELEMENT).set(bigIntToFixedByteArray(rr, MODULUS_SIZE).reverse(), 2 * WORD_SIZE + MODULUS_SIZE);
        dv.setUint32(2 * WORD_SIZE + 2 * MODULUS_SIZE, key.e, true);
        return new Uint8Array(buffer);
    }

    function padLeft(value, width, char) {
        const str = value.toString();
        return char.repeat(Math.max(0, width - str.length)) + str;
    }

    /**
     * Decode the web safe base64url string to a hex number (assuming the encoded
     * data was a big endian number).
     */
    function decodeWebBase64ToHex(str) {
        const bytes = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
        let hex = '';
        for (let i = 0; i < bytes.length; ++i) {
            hex += padLeft(bytes.charCodeAt(i).toString(16), 2, '0');
        }
        return hex;
    }

    /*
     * Generates a new key and stores it in local storate
     */
    async function generateNewKeyPair() {
        var keypair = await Promise.resolve(crypto.subtle.generateKey({
            ...ADB_WEB_CRYPTO_ALGORITHM,
            modulusLength: MODULUS_SIZE_BITS,
            publicExponent: PUBLIC_EXPONENT,
        },
            ADB_WEB_CRYPTO_EXPORTABLE, ADB_WEB_CRYPTO_OPERATIONS));
        var jwk = await Promise.resolve(crypto.subtle.exportKey('jwk', keypair.publicKey));

        var jsbnKey = new RSAKey();
        jsbnKey.setPublic(decodeWebBase64ToHex(jwk.n), decodeWebBase64ToHex(jwk.e));

        const bytes = encodeAndroidPublicKeyBytes(jsbnKey);
        const userInfo = 'unknown@web-hv';
        var publicKey = btoa(String.fromCharCode.apply(null, bytes)) + ' ' + userInfo;

        var fullKey = await Promise.resolve(crypto.subtle.exportKey("jwk", keypair.privateKey));
        fullKey.publicKey = btoa(String.fromCharCode.apply(null, bytes)) + ' ' + userInfo;

        localStorage.cryptoKey = JSON.stringify(fullKey);
        return localStorage.cryptoKey;
    }

    function AdbKeyInternal() {
        window.dd = this;

        this.fullKey = localStorage.cryptoKey;
        this.keyPromise = !!this.fullKey ? Promise.resolve(this.fullKey) : generateNewKeyPair();
    }

    AdbKeyInternal.prototype.sign = function (token) {
        var jwk = JSON.parse(this.fullKey);

        key = new RSAKey();
        key.setPrivateEx(
            decodeWebBase64ToHex(jwk.n), decodeWebBase64ToHex(jwk.e),
            decodeWebBase64ToHex(jwk.d), decodeWebBase64ToHex(jwk.p),
            decodeWebBase64ToHex(jwk.q), decodeWebBase64ToHex(jwk.dp),
            decodeWebBase64ToHex(jwk.dq), decodeWebBase64ToHex(jwk.qi));

        const bitLength = key.n.bitLength();
        // Message Layout (size equals that of the key modulus):
        // 00 01 FF FF FF FF ... FF [ASN.1 PREFIX] [TOKEN]
        const message = new Uint8Array(MODULUS_SIZE);

        // Initially just fill the buffer with the padding
        message.fill(0xFF);

        // add prefix
        message[0] = 0x00;
        message[1] = 0x01;

        // add the ASN.1 prefix
        message.set(
            SIGNING_ASN1_PREFIX,
            message.length - SIGNING_ASN1_PREFIX.length - token.length);

        // then the actual token at the end
        message.set(token, message.length - token.length);

        const messageInteger = new BigInteger(Array.apply([], message));
        const signature = key.doPrivate(messageInteger);
        return new Uint8Array(bigIntToFixedByteArray(signature, MODULUS_SIZE));
    }

    AdbKeyInternal.prototype.publicKey = async function () {
        var json = await this.keyPromise;
        var fullKey = JSON.parse(json);
        return fullKey.publicKey;
    }

    return AdbKeyInternal;

})();