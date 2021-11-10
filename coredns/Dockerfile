FROM coredns/coredns
ADD Corefile /root/Corefile
ADD schl.es.db /root/schl.es.db
EXPOSE "53/udp"
CMD ["-conf", "/root/Corefile"]
