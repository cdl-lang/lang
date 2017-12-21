#!/bin/bash

set -u -e

OPENSSL=openssl
OPENSSLCONF=openssl.cnf

CACERT=rootCA.pem
CAKEY=rootCA.key

PKCS12PASSWORD="pass:insecure_983234925477423"

function usage {
	echo "Usage: $0 [ -p <CA-sign-key-pass-phrase>] \\"
    echo "        -d dns1:dns2:dns3 -i ip1:ip2:ip3 [-h hostname ]"
    echo " "
    echo " "
	echo "For example:"
	echo "$0 -p 'my secret' -d \"komphy.home:komphy.mondriatech.com\" " \
		"-i \"127.0.0.1:192.168.1.8\""
	exit 1
}

function join {
	local IFS=","
	echo "$*"
}

if [ $# -eq 0 ]; then
	usage
fi

HOST=`hostname`

DNS=
IPADDR=
password=

while getopts :d:i:h:p: flag
do
  case ${flag} in
    d)
	DNS=${OPTARG}
	;;

    i)
	IPADDR=${OPTARG}
	;;

    h)
	HOST=${OPTARG}
	;;

    p)
    password=${OPTARG}
    ;;

    \?)
	usage
	;;
  esac
done

if [ "x${DNS}" == "x" ]; then
    echo "$0: sorry, you must specify '-d <dns-names>'"
    exit 1
fi

if [ "x${IPADDR}" == "x" ]; then
    echo "$0: sorry, you must specify '-i <ip-addreses>'"
    exit 1
fi


# split dns and ip
OLDIFS=${IFS}
IFS=':' read -a DNSA <<< "${DNS}"
IFS=':' read -a IPA <<< "${IPADDR}"
IFS=${OLDIFS}

# add 'DNS:'/'IP:' prefix
DNSA=${DNSA[@]/#/DNS:}
IPA=${IPA[@]/#/IP:}

# join with commas
DNSA=`join ${DNSA}`
IPA=`join ${IPA}`

export ALTNAME
ALTNAME="${DNSA}","${IPA}"

SUBJECT="/O=mondria/OU=testing/OU=insecure/CN=${HOST}.insecure.mondriatech.com"

# generate key
${OPENSSL} genrsa -out ${HOST}.key 2048 -config ${OPENSSLCONF}

# generate certificate request
${OPENSSL} req -new -key ${HOST}.key -out ${HOST}.csr -config ${OPENSSLCONF} \
    -subj ${SUBJECT}

# sign the certificate request, generating the certificate
${OPENSSL} x509 -req -in ${HOST}.csr -CA ${CACERT} -CAkey ${CAKEY} \
	-CAcreateserial -out ${HOST}.crt -days 800 \
    -passin "pass:${password}" \
    -extensions v3_req -extfile ${OPENSSLCONF}

${OPENSSL} pkcs12 \
    -export \
    -in ${HOST}.crt \
    -inkey ${HOST}.key \
    -passout ${PKCS12PASSWORD} \
    -out ${HOST}.p12

echo "Created ${HOST}.key, ${HOST}.csr, ${HOST}.crt and ${HOST}.p12"

exit 0
