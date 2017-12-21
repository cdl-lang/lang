#!/bin/bash

set -u -e

OPENSSL=openssl

CACERT=rootCA.pem
CAKEY=rootCA.key

RANDSEED=rand.seed
MINRANDSEED=100

Iopt=
password=

while getopts I:p: flag
do
  case ${flag} in
    I)
          Iopt=${OPTARG}
          ;;

    p)
          password="${OPTARG}"
          ;;
  esac
done

if [ "${Iopt}" != "insist" ]; then
    echo "$0: Please do not generate a new certificate authority; instead,"
    echo " please use the one stored in the repository"
    exit 1
fi

# generate a seed
echo "please generate some randomness, e.g. move/click mouse etc"
echo > ${RANDSEED}
until [ $(wc -c "${RANDSEED}" | cut -f 1 -d ' ') -ge ${MINRANDSEED} ]; do
    dd if=/dev/random bs=1 count=1 >> ${RANDSEED} 2>/dev/null
    echo -ne "\r$(wc -c ${RANDSEED} | cut -f 1 -d ' ') / ${MINRANDSEED}"
done
echo " "
echo "seed generated"
echo " "

# create CA private key
${OPENSSL} genrsa -aes128 \
    -passout "pass:${password}" \
    -rand ${RANDSEED} \
    -out rootCA.key 2048 

rm rand.seed

# create self-signed certificate
${OPENSSL} req \
    -passin "pass:${password}" \
    -x509 -new -nodes -key ${CAKEY} -days 2000 -out ${CACERT} \
    -subj "/O=mondria/OU=testing/OU=insecure/CN=ca.insecure.mondriatech.com"


echo "Generated ${CAKEY} and ${CACERT}"
exit 0
