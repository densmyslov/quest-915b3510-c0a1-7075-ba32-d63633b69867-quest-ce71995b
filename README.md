This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Features

### 🗺️ Interactive Quest Map
- Real-time GPS tracking with compass support
- Proximity-triggered audio effects
- Pulsating visual effects for quest objects
- Itinerary-based step navigation

### 🔊 Advanced Audio System
- **Multiple unlock methods**: Pulsing button, map interaction, or GPS toggle
- **Automatic proximity triggers**: Audio plays when approaching quest objects
- **Full mobile support**: iOS Safari and Android Chrome compatible
- **Visual feedback**: Clear notifications and pulsing button indicator

### 🧩 Puzzle Distribution
- Fair team-based puzzle assignment
- Solo and multiplayer support
- Deterministic distribution algorithm

### 📱 Mobile-Optimized
- Touch-friendly interface
- Responsive design
- Offline-capable with service workers

## Environment Variables

### Local Development

Create a `.env.local` file in the root directory with the following variables:

```env
# Enable Steps Mode for testing (optional)
NEXT_PUBLIC_ENABLE_STEPS_MODE=true

# Quest API URLs (required for full functionality)
NEXT_PUBLIC_QUEST_API_URL=https://your-quest-api.example.com
NEXT_PUBLIC_RUNTIME_API_URL=https://your-runtime-api.example.com
NEXT_PUBLIC_RUNTIME_WS_URL=wss://your-websocket-api.example.com
```

**Steps Mode**: Set `NEXT_PUBLIC_ENABLE_STEPS_MODE=true` to enable manual quest progression without GPS movement. Useful for development, testing, and demonstrations. See [STEPS_MODE.md](./docs/STEPS_MODE.md) for details.

### Production Deployments

Environment variables are automatically configured by the Quest Platform deployment manager. To modify them:
1. Update `deployment_logic.py` in quest-platform backend
2. Redeploy via GitHub Actions (never deploy locally - see quest-platform docs)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Documentation

### Quick Start
- [Audio Quick Start](./docs/AUDIO_QUICK_START.md) - ⚡ Get audio working in 5 minutes

### Quest Features
- [Audio Effects Configuration](./docs/AUDIO_EFFECTS.md) - Configure proximity-triggered audio
- [Audio Unlock System](./docs/AUDIO_UNLOCK_SYSTEM.md) - Technical details on audio unlocking
- [Map Effects](./docs/MAP_EFFECTS.md) - Pulsating effects and visual customization
- [Puzzle Distribution](./docs/PUZZLE_DISTRIBUTION.md) - Team puzzle assignment system
- [Steps Mode](./docs/STEPS_MODE.md) - Manual quest progression for testing/development

### Technical Guides
- [Audio Trigger Fix](./docs/AUDIO_TRIGGER_FIX.md) - Troubleshooting audio issues
- [Workers Configuration](./docs/WORKER_FIX_GUIDE.md) - Cloudflare Workers setup

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Branching Strategy

By default, all commits and pushes should be made to the `dev` branch unless specifically requested otherwise. This ensures that the development environment remains the primary integration point.

**Important:** Commits and pushes must be strictly limited to changes made by the editor (you). Changes made by external sources or other users should not be pushed to avoid conflicts and unintended overwrites.

## Contributing

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
