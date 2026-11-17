/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // The mock Pipeline page was replaced by Meetings.
      { source: '/pipeline', destination: '/meetings', permanent: false },
      // The SDR page became the Overview, the home page (Ayush, 2026-11-17); old links keep working.
      { source: '/sdrs', destination: '/', permanent: false },
    ];
  },
};

export default nextConfig;
