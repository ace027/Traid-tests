import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('renders the app shell with the Series page', () => {
    render(<App />);
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Series' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sonarr home' })).toBeInTheDocument();
  });

  it('renders NotFound for unknown URLs', () => {
    window.history.pushState({}, '', '/nope');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });
});
