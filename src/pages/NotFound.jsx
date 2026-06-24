import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-primary">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-300 dark:text-white/20 mb-4">404</h1>
        <p className="text-gray-600 dark:text-white/60 text-sm mb-6">Page not found.</p>
        <div className="flex gap-4 justify-center">
          <Link to="/" className="text-sm text-accent hover:text-accent/80 transition-colors">Home</Link>
          <Link to="/login" className="text-sm text-accent hover:text-accent/80 transition-colors">Login</Link>
        </div>
      </div>
    </div>
  )
}
