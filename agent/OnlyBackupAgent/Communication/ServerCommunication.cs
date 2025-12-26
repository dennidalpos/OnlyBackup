using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Web.Script.Serialization;

namespace OnlyBackupAgent.Communication
{
    public class ServerCommunication
    {
        private readonly string serverHost;
        private readonly int serverPort;
        private readonly JavaScriptSerializer jsonSerializer;
        private int agentPort;

        public ServerCommunication(string serverHost, int serverPort)
        {
            this.serverHost = serverHost;
            this.serverPort = serverPort;
            this.jsonSerializer = new JavaScriptSerializer();
            this.agentPort = 8081;
        }

        public void SetAgentPort(int port)
        {
            this.agentPort = port;
        }

        public void SendHeartbeat(string hostname, string backupStatus = null, string backupJobId = null)
        {
            try
            {
                string localIp = GetLocalIPAddress();

                var data = new
                {
                    hostname = hostname,
                    timestamp = DateTime.UtcNow.ToString("o"),
                    status = "online",
                    agent_ip = localIp,
                    agent_port = agentPort,
                    backup_status = backupStatus,
                    backup_job_id = backupJobId
                };

                PostToServer("/api/agent/heartbeat", data);
            }
            catch (Exception)
            {
            }
        }

        private string GetLocalIPAddress()
        {
            try
            {
                using (Socket socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, 0))
                {
                    socket.Connect(serverHost, serverPort);
                    IPEndPoint endPoint = socket.LocalEndPoint as IPEndPoint;
                    if (endPoint != null && endPoint.Address != null)
                    {
                        return endPoint.Address.ToString();
                    }
                    return "127.0.0.1";
                }
            }
            catch
            {
                return "127.0.0.1";
            }
        }

        public void LogMessage(string message)
        {
            try
            {
                Console.WriteLine(String.Format("[ServerComm] {0}", message));
            }
            catch { }
        }

        private void PostToServer(string endpoint, object data)
        {
            string url = String.Format("http://{0}:{1}{2}", serverHost, serverPort, endpoint);

            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "POST";
            request.ContentType = "application/json";
            request.Timeout = 10000;

            string json = jsonSerializer.Serialize(data);
            byte[] buffer = Encoding.UTF8.GetBytes(json);

            request.ContentLength = buffer.Length;

            using (Stream requestStream = request.GetRequestStream())
            {
                requestStream.Write(buffer, 0, buffer.Length);
            }

            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            {
                if (response.StatusCode != HttpStatusCode.OK)
                {
                    throw new Exception(String.Format("Server ha risposto con status {0}", response.StatusCode));
                }
            }
        }
    }
}
