/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    // The mock Pipeline page was replaced by Meetings.
    return [{ source: '/pipeline', destination: '/meetings', permanent: false }];
  },
};

export default nextConfig;
