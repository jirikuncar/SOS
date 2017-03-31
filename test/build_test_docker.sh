#!/usr/bin/bash

#
# Make sure we have local public key
# 
instance=$(docker ps | grep test_sos)
if [ "${instance}" != "" ]
then
    #echo "sshd is already running"
    #exit
    docker stop test_sos
fi

docker rm test_sos
docker rmi eg_sshd

# this will create ~/.ssh/id_rsa.pub and ~/.ssh/id_rsa
[ -f ~/.ssh/id_rsa.pub ] || ssh-keygen -q -t rsa -N '' -f ~/.ssh/id_rsa
# copy the public key here
cp ~/.ssh/id_rsa.pub authorized_keys

# create a docker file
# 
cat > Dockerfile << HERE
FROM python:3.6

RUN apt-get update && apt-get install -y openssh-server rsync task-spooler
RUN mkdir /var/run/sshd
RUN echo 'root:screencast' | chpasswd
RUN sed -i 's/PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config

# SSH login fix. Otherwise user is kicked off after login
RUN sed 's@session\s*required\s*pam_loginuid.so@session optional pam_loginuid.so@g' -i /etc/pam.d/sshd

ENV NOTVISIBLE "in users profile"
RUN echo "export VISIBLE=now" >> /etc/profile

RUN [ -d /root/.ssh ] || mkdir -p /root/.ssh
ADD authorized_keys /root/.ssh/authorized_keys

# install sos on the remote host
RUN  pip install spyder notebook nbconvert nbformat pyyaml psutil tqdm
RUN  pip install fasteners pygments ipython ptpython networkx pydotplus
RUN  git clone http://github.com/vatlab/SOS sos
RUN  cd sos && python setup.py install

RUN  echo "export TS_SLOTS=10" >> /root/.bash_profile

EXPOSE 22
CMD ["/usr/sbin/sshd", "-D"]
HERE

#

#
# Build the docker image
#
docker build -t eg_sshd .

#
# start docker image
docker run -d -P --env TS_SLOTS=10 --name test_sos eg_sshd

# get the port
PORT=$(docker port test_sos 22 | cut -f2 -d:)

# add the docker machine to known_hosts so that sos will not be
# prompt with the message "are you sure you want to connect"?

ssh  -o 'StrictHostKeyChecking no' -p $PORT root@localhost exit

# write a host file
cat > docker.yml << HERE
localhost: me
hosts:
    me:
        description: localhost
        alias: localhost
        paths:
            home: $HOME
    docker:
        address: root@localhost
        port: $PORT
        paths:
            home: /root
    ts:
        description: task spooler on the docker machine
        address: root@localhost
        port: $PORT
HERE

# this part is not interpolated
cat >> docker.yml << 'HERE'
        paths:
            home: /root
        queue_type: pbs
        status_check_interval: 5
        job_template: |
            #!/bin/bash
            cd ${cur_dir}
            sos execute ${task} -v ${verbosity} -s ${sig_mode} ${'--dryrun' if run_mode == 'dryrun' else ''}
        max_running_jobs: 100
        submit_cmd: tsp -L ${task} sh ${job_file}
        status_cmd: tsp -s ${job_id}
        kill_cmd: tsp -w ${job_id}
HERE
