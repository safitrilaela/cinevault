/* =========================================================
   CINEVAULT - Logika aplikasi (Alpine.js)
   Dimuat SEBELUM Alpine agar movieApp() tersedia saat init.
   Stateless: tidak memakai localStorage / sessionStorage.
   Setiap request ke TMDB membawa api_key sendiri.
   ========================================================= */

function movieApp() {
  const thisYear = new Date().getFullYear();

  return {
    // ====== KONFIGURASI ======
    // Ganti dengan API Key TMDB milikmu sendiri (themoviedb.org > Settings > API)
    apiKey: '57c141d27605ae52d4d5a0410c984e06',
    baseUrl: 'https://api.themoviedb.org/3',
    imgUrl: 'https://image.tmdb.org/t/p',

    // ====== STATE (hanya di memori) ======
    movies: [],
    heroes: [],
    heroIndex: 0,
    top10: [],

    query: '',
    lastQuery: '',
    isSearching: false,
    year: '',                 // '' = semua tahun
    page: 1,
    totalPages: 1,

    loading: false,
    loadingMore: false,
    error: '',
    scrolled: false,

    modalOpen: false,
    detailLoading: false,
    selected: null,
    trailerUrl: '',

    // Daftar tahun untuk filter
    recentYears: Array.from({ length: 8 }, (_, i) => thisYear - i),
    allYears: Array.from({ length: thisYear - 1950 + 1 }, (_, i) => thisYear - i),

    // ====== COMPUTED ======
    get isDefault() {
      return !this.isSearching && !this.year;
    },
    get hero() {
      return this.heroes[this.heroIndex] || null;
    },
    get hasMore() {
      return this.page < this.totalPages;
    },
    get sectionTitle() {
      if (this.isSearching) {
        return 'Hasil: "' + this.lastQuery + '"' + (this.year ? ' • ' + this.year : '');
      }
      if (this.year) return 'Film Rilisan ' + this.year;
      return 'Film Populer';
    },

    // ====== INIT ======
    init() {
      this.loadPopularMovies();
      this.loadTop10();
      // Hero berganti otomatis tiap 6 detik
      setInterval(() => {
        if (this.heroes.length > 1 && this.isDefault && !this.modalOpen) {
          this.heroIndex = (this.heroIndex + 1) % this.heroes.length;
        }
      }, 6000);
    },

    // ====== REQUEST (stateless) ======
    async request(path, params = {}) {
      const url = new URL(this.baseUrl + path);
      url.searchParams.set('api_key', this.apiKey);
      url.searchParams.set('language', 'id-ID');
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

      const res = await fetch(url);
      if (res.status === 401) {
        throw new Error('API Key TMDB tidak valid. Periksa kembali apiKey di app.js.');
      }
      if (!res.ok) throw new Error('Gagal mengambil data (kode ' + res.status + ').');
      return res.json();
    },

    // Mengambil daftar film sesuai mode: pencarian / filter tahun / populer
    async fetchList(append = false) {
      if (append) {
        this.loadingMore = true;
      } else {
        this.loading = true;
        this.page = 1;
      }
      this.error = '';

      const nextPage = append ? this.page + 1 : 1;

      try {
        let data;
        if (this.isSearching) {
          const params = { query: this.lastQuery, page: nextPage };
          if (this.year) params.primary_release_year = this.year;
          data = await this.request('/search/movie', params);
        } else if (this.year) {
          data = await this.request('/discover/movie', {
            primary_release_year: this.year,
            sort_by: 'popularity.desc',
            'vote_count.gte': 20,
            page: nextPage
          });
        } else {
          data = await this.request('/movie/popular', { page: nextPage });
        }

        this.page = data.page;
        this.totalPages = Math.min(data.total_pages || 1, 500);
        this.movies = append ? this.movies.concat(data.results) : data.results;

        // Hero hanya untuk tampilan awal
        if (!append && this.isDefault) {
          this.heroes = data.results.filter(m => m.backdrop_path).slice(0, 5);
          this.heroIndex = 0;
        }
      } catch (e) {
        if (!append) this.movies = [];
        this.error = e.message;
      } finally {
        this.loading = false;
        this.loadingMore = false;
      }
    },

    // ====== FUNGSI UTAMA ======
    async loadPopularMovies() {
      this.isSearching = false;
      this.year = '';
      await this.fetchList();
    },

    async searchMovies() {
      const q = this.query.trim();
      if (!q) {
        this.isSearching = false;
        this.lastQuery = '';
        return this.fetchList();
      }
      this.isSearching = true;
      this.lastQuery = q;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await this.fetchList();
    },

    // Filter berdasarkan tahun rilis (bisa digabung dengan pencarian)
    async setYear(y) {
      this.year = String(y || '');
      await this.fetchList();
      const el = document.getElementById('daftar-film');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    loadMore() {
      if (this.hasMore && !this.loadingMore) this.fetchList(true);
    },

    resetSearch() {
      this.query = '';
      this.lastQuery = '';
      this.loadPopularMovies();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    focusSearch() {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      this.$nextTick(() => this.$refs.searchInput && this.$refs.searchInput.focus());
    },

    // Top 10 minggu ini (pelengkap tampilan, gagal pun tidak masalah)
    async loadTop10() {
      try {
        const data = await this.request('/trending/movie/week');
        this.top10 = data.results.filter(m => m.poster_path).slice(0, 10);
      } catch (e) {
        this.top10 = [];
      }
    },

    async openDetail(id) {
      this.modalOpen = true;
      this.detailLoading = true;
      this.selected = null;
      this.trailerUrl = '';
      document.body.classList.add('overflow-hidden');

      try {
        const movie = await this.request('/movie/' + id, { append_to_response: 'videos' });

        // Sinopsis kosong (bahasa Indonesia) -> ambil versi Inggris
        if (!movie.overview) {
          const en = await this.request('/movie/' + id, { language: 'en-US' });
          movie.overview = en.overview;
        }

        // Cari trailer YouTube; jika tidak ada, coba versi Inggris
        let videos = (movie.videos && movie.videos.results) || [];
        if (!videos.some(v => v.site === 'YouTube')) {
          const vids = await this.request('/movie/' + id + '/videos', { language: 'en-US' });
          videos = vids.results || [];
        }
        const trailer =
          videos.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
          videos.find(v => v.site === 'YouTube');
        this.trailerUrl = trailer ? 'https://www.youtube.com/watch?v=' + trailer.key : '';

        this.selected = movie;
      } catch (e) {
        this.closeModal();
        this.error = e.message;
      } finally {
        this.detailLoading = false;
      }
    },

    closeModal() {
      this.modalOpen = false;
      this.selected = null;
      document.body.classList.remove('overflow-hidden');
    },

    // ====== HELPER ======
    posterUrl(path, size = 'w500') {
      return path
        ? this.imgUrl + '/' + size + path
        : 'https://placehold.co/500x750/16161d/ffc400?text=No+Poster';
    },
    backdropUrl(path) {
      return path
        ? this.imgUrl + '/w1280' + path
        : 'https://placehold.co/1280x720/16161d/22222c?text=+';
    },
    getYear(date) {
      return date ? date.slice(0, 4) : '-';
    },
    formatRating(n) {
      return typeof n === 'number' ? n.toFixed(1) : '-';
    }
  };
}